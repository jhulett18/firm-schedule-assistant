import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, MapPin, Video, CheckCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { LoadingState } from "@/components/public-booking/LoadingState";
import { ExpiredOrCancelledState } from "@/components/public-booking/ExpiredOrCancelledState";
import { ErrorState } from "@/components/public-booking/ErrorState";
import { TimezoneSelector } from "@/components/public-booking/TimezoneSelector";
import { ApiDebugButton, type ApiCall } from "@/components/public-booking/ApiDebugPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScheduleCalendarPicker } from "@/components/public-booking/ScheduleCalendarPicker";

const ACTIVE_BOOKING_TOKEN_KEY = 'ACTIVE_BOOKING_TOKEN';

type ScheduleState = 
  | "loading" 
  | "needs_scheduling" 
  | "no_available_times" 
  | "already_booked" 
  | "expired" 
  | "cancelled" 
  | "error";

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

interface MeetingSummary {
  meetingTypeName: string;
  durationMinutes: number;
  locationMode: "Zoom" | "InPerson";
  timezone: string;
  startDatetime?: string;
  endDatetime?: string;
}

interface ContactSettings {
  phone?: string;
  email?: string;
  message?: string;
}

export default function Schedule() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [currentState, setCurrentState] = useState<ScheduleState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("Something went wrong");
  const [token, setToken] = useState<string | null>(null);
  
  const [meeting, setMeeting] = useState<MeetingSummary | null>(null);
  const [contact, setContact] = useState<ContactSettings>({});
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clientTimezone, setClientTimezone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );
  const [isRetrying, setIsRetrying] = useState(false);
  
  // API Debug state
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [confirmWarnings, setConfirmWarnings] = useState<string[]>([]);

  // Helper to record API calls
  const recordApiCall = useCallback((call: Omit<ApiCall, 'id' | 'timestamp'>) => {
    setApiCalls(prev => [...prev, {
      ...call,
      id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
    }]);
  }, []);

  // Fetch booking info from edge function
  const fetchBookingInfo = useCallback(async (bookingToken: string) => {
    const startTime = Date.now();
    const requestBody = { token: bookingToken };
    
    try {
      const { data, error } = await supabase.functions.invoke("public-booking-info", {
        body: requestBody,
      });

      recordApiCall({
        name: "public-booking-info",
        request: { method: "POST", body: requestBody },
        response: {
          status: error ? 500 : 200,
          body: data || undefined,
        },
        error: error?.message,
        duration: Date.now() - startTime,
      });

      if (error) {
        console.error("Error fetching booking info:", error);
        setErrorMessage("Failed to load booking information");
        setCurrentState("error");
        return;
      }

      // Safely access response properties
      if (data?.error) {
        setErrorMessage(data.error);
        setCurrentState("error");
        return;
      }

      // Safely extract meeting data with fallbacks
      if (data?.meeting) {
        setMeeting(data.meeting);
      }
      setContact(data?.contact || {});

      const state = data?.state;
      if (state === "already_booked") {
        setCurrentState("already_booked");
        return;
      }

      if (state === "expired") {
        setCurrentState("expired");
        return;
      }

      if (state === "cancelled") {
        setCurrentState("cancelled");
        return;
      }

      // Needs scheduling - fetch available slots
      setCurrentState("needs_scheduling");
      await fetchAvailableSlots(bookingToken);
      
    } catch (err) {
      console.error("Error in fetchBookingInfo:", err);
      recordApiCall({
        name: "public-booking-info",
        request: { method: "POST", body: requestBody },
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - startTime,
      });
      setErrorMessage("An unexpected error occurred");
      setCurrentState("error");
    }
  }, [recordApiCall]);

  // Fetch available slots from edge function
  const fetchAvailableSlots = async (bookingToken: string) => {
    setIsLoadingSlots(true);
    const startTime = Date.now();
    const requestBody = { token: bookingToken, clientTimezone };
    
    try {
      const { data, error } = await supabase.functions.invoke("public-available-slots", {
        body: requestBody,
      });

      recordApiCall({
        name: "public-available-slots",
        request: { method: "POST", body: requestBody },
        response: {
          status: error ? 500 : 200,
          body: data || undefined,
        },
        error: error?.message,
        duration: Date.now() - startTime,
      });

      if (error) {
        console.error("Error fetching slots:", error);
        setAvailableSlots([]);
        return;
      }

      // Safely access slots with fallback
      const slots = Array.isArray(data?.slots) ? data.slots : [];
      setAvailableSlots(slots);
      
      if (slots.length === 0) {
        setCurrentState("no_available_times");
      }
    } catch (err) {
      console.error("Error fetching slots:", err);
      recordApiCall({
        name: "public-available-slots",
        request: { method: "POST", body: requestBody },
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - startTime,
      });
      setAvailableSlots([]);
    } finally {
      setIsLoadingSlots(false);
    }
  };

  useEffect(() => {
    const storedToken = localStorage.getItem(ACTIVE_BOOKING_TOKEN_KEY);
    
    if (!storedToken) {
      navigate('/access');
      return;
    }

    setToken(storedToken);
    fetchBookingInfo(storedToken);
  }, [fetchBookingInfo, navigate]);

  const handleRetry = async () => {
    if (!token) return;
    setIsRetrying(true);
    setCurrentState("loading");
    await fetchBookingInfo(token);
    setIsRetrying(false);
  };

  const handleRefreshSlots = async () => {
    if (!token) return;
    await fetchAvailableSlots(token);
    if (availableSlots.length > 0) {
      setCurrentState("needs_scheduling");
    }
  };

  // Confirm booking - ROBUST error handling
  const handleConfirmSlot = async () => {
    if (!selectedSlot || !token) return;

    setConfirming(true);
    setConfirmWarnings([]);
    const startTime = Date.now();
    const requestBody = {
      token,
      startDatetime: selectedSlot.start,
      endDatetime: selectedSlot.end,
    };

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("confirm-booking", {
        body: requestBody,
      });

      // Record API call regardless of outcome
      recordApiCall({
        name: "confirm-booking",
        request: { method: "POST", body: requestBody },
        response: {
          status: invokeError ? 500 : 200,
          body: data || undefined,
        },
        error: invokeError?.message,
        duration: Date.now() - startTime,
      });

      // Check for invoke-level error
      if (invokeError) {
        throw new Error(invokeError.message || "Failed to confirm booking");
      }

      // Check if data exists at all
      if (!data) {
        throw new Error("Empty response from server");
      }

      // Capture warnings if present (array of strings)
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setConfirmWarnings(data.warnings);
      }

      // Check for success - be flexible about response shape
      if (data.success === true) {
        // Update meeting state with confirmed times
        setMeeting(prev => prev ? {
          ...prev,
          startDatetime: selectedSlot.start,
          endDatetime: selectedSlot.end,
        } : null);
        
        toast({
          title: "Meeting Confirmed!",
          description: data.warnings?.length 
            ? "Your meeting is scheduled. Some integrations had warnings."
            : "Your meeting has been scheduled successfully.",
        });
        
        // Show the already_booked state with debug button
        setCurrentState("already_booked");
        return;
      }

      // Check for explicit error in response
      if (data.error) {
        if (typeof data.error === 'string' && data.error.toLowerCase().includes("already")) {
          setCurrentState("already_booked");
          return;
        }
        throw new Error(data.error);
      }

      // Fallback - if success is not true and no error, something unexpected happened
      if (data.success === false) {
        throw new Error("Booking was not successful");
      }

      // If we got here with some data but no clear success/error, treat as unexpected
      throw new Error("Unexpected response format from server");

    } catch (err: any) {
      console.error("Booking confirmation error:", err);
      
      // Record the error if not already recorded
      if (!apiCalls.find(c => c.name === "confirm-booking" && Date.now() - c.timestamp.getTime() < 1000)) {
        recordApiCall({
          name: "confirm-booking",
          request: { method: "POST", body: requestBody },
          error: err.message || String(err),
          duration: Date.now() - startTime,
        });
      }
      
      setErrorMessage(err.message || "We were unable to complete your booking. Please contact us directly.");
      setCurrentState("error");
    } finally {
      setConfirming(false);
    }
  };

  const getLocationDisplay = () => {
    if (!meeting) return "";
    if (meeting.locationMode === "Zoom") {
      return "Video call (link will be sent via email)";
    }
    return "In-person at our office";
  };

  // Render based on current state
  if (currentState === "loading") {
    return <LoadingState />;
  }

  if (currentState === "error") {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-lg mx-auto space-y-6">
          <ErrorState
            message={errorMessage}
            onRetry={handleRetry}
            isRetrying={isRetrying}
            contactEmail={contact.email}
            contactPhone={contact.phone}
          />
          
          {/* Debug button always available on error */}
          {apiCalls.length > 0 && (
            <div className="flex justify-center">
              <ApiDebugButton calls={apiCalls} hasWarnings />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentState === "expired" || currentState === "cancelled") {
    return (
      <ExpiredOrCancelledState
        reason={currentState === "expired" ? "expired" : "cancelled"}
        contactEmail={contact.email}
        contactPhone={contact.phone}
        contactMessage={contact.message}
      />
    );
  }

  if (currentState === "already_booked" && meeting) {
    const startDate = meeting.startDatetime ? new Date(meeting.startDatetime) : new Date();
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-lg mx-auto space-y-6">
          <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-foreground mb-2">You're All Set!</h2>
                  <p className="text-muted-foreground">
                    Your meeting has been scheduled. We look forward to speaking with you.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Show warnings if any */}
          {confirmWarnings.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                <p className="font-medium text-amber-800 dark:text-amber-200 mb-2">
                  Booking confirmed with warnings:
                </p>
                <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                  {confirmWarnings.map((w, i) => (
                    <li key={i} className="break-words">{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Meeting details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{meeting.meetingTypeName}</CardTitle>
              <CardDescription>Meeting Details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{format(startDate, "EEEE, MMMM d, yyyy 'at' h:mm a")}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{meeting.durationMinutes} minutes</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                {meeting.locationMode === "Zoom" ? (
                  <Video className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                )}
                <span>{getLocationDisplay()}</span>
              </div>
            </CardContent>
          </Card>
          
          {/* Debug button */}
          {apiCalls.length > 0 && (
            <div className="flex justify-center">
              <ApiDebugButton calls={apiCalls} hasWarnings={confirmWarnings.length > 0} />
            </div>
          )}
          
          {/* Back to Client View */}
          <div className="text-center">
            <Button variant="ghost" onClick={() => navigate('/client')}>
              Back to My Appointments
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Main scheduling view - includes both needs_scheduling and no_available_times states
  // The ScheduleCalendarPicker handles the empty state internally
  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Compact Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {meeting?.meetingTypeName || "Schedule Your Meeting"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {meeting?.durationMinutes} min • {meeting?.locationMode === "Zoom" ? "Video call" : "In-person"}
            </p>
          </div>
          <TimezoneSelector 
            timezone={clientTimezone} 
            onTimezoneChange={setClientTimezone} 
          />
        </div>

        {/* Calendar + Times Picker */}
        <ScheduleCalendarPicker
          slots={availableSlots}
          selectedSlot={selectedSlot}
          onSelectSlot={setSelectedSlot}
          clientTimezone={clientTimezone}
          isLoading={isLoadingSlots}
          onRefresh={() => token && fetchAvailableSlots(token)}
        />

        {/* Confirm Button */}
        {selectedSlot && (
          <Button
            className="w-full h-12 text-base"
            onClick={handleConfirmSlot}
            disabled={confirming}
          >
            {confirming ? "Confirming..." : "Confirm This Time"}
          </Button>
        )}

        {/* Debug button - always available for troubleshooting */}
        {apiCalls.length > 0 && (
          <div className="flex justify-center">
            <ApiDebugButton calls={apiCalls} />
          </div>
        )}

        {/* Back to Client View */}
        <div className="text-center">
          <Button variant="ghost" onClick={() => navigate('/client')}>
            Back to My Appointments
          </Button>
        </div>
      </div>
    </div>
  );
}
