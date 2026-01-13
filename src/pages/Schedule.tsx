import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, MapPin, Video, CheckCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { LoadingState } from "@/components/public-booking/LoadingState";
import { GuidedHelpPanel } from "@/components/public-booking/GuidedHelpPanel";
import { NoAvailableTimesState } from "@/components/public-booking/NoAvailableTimesState";
// AlreadyBookedState not used - inline implementation with debug button
import { ExpiredOrCancelledState } from "@/components/public-booking/ExpiredOrCancelledState";
import { ErrorState } from "@/components/public-booking/ErrorState";
import { TimezoneSelector } from "@/components/public-booking/TimezoneSelector";
import { LawmaticsDebugButton } from "@/components/public-booking/LawmaticsDebugPanel";

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

interface LawmaticsDebugData {
  contact?: { attempted: boolean; endpoint?: string; status?: number; id?: string; body_excerpt?: string };
  matter?: { attempted: boolean; endpoint?: string; status?: number; id?: string; body_excerpt?: string };
  event?: { attempted: boolean; endpoint?: string; status?: number; id?: string; body_excerpt?: string };
  timestamp?: string;
}

export default function Schedule() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const slotSectionRef = useRef<HTMLDivElement>(null);
  
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
  const [lawmaticsDebug, setLawmaticsDebug] = useState<LawmaticsDebugData | null>(null);

  // Fetch booking info from edge function
  const fetchBookingInfo = useCallback(async (bookingToken: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("public-booking-info", {
        body: { token: bookingToken },
      });

      if (error) {
        console.error("Error fetching booking info:", error);
        setErrorMessage("Failed to load booking information");
        setCurrentState("error");
        return;
      }

      if (data.error) {
        setErrorMessage(data.error);
        setCurrentState("error");
        return;
      }

      setMeeting(data.meeting);
      setContact(data.contact || {});

      if (data.state === "already_booked") {
        setCurrentState("already_booked");
        return;
      }

      if (data.state === "expired") {
        setCurrentState("expired");
        return;
      }

      if (data.state === "cancelled") {
        setCurrentState("cancelled");
        return;
      }

      // Needs scheduling - fetch available slots
      setCurrentState("needs_scheduling");
      await fetchAvailableSlots(bookingToken);
      
    } catch (err) {
      console.error("Error in fetchBookingInfo:", err);
      setErrorMessage("An unexpected error occurred");
      setCurrentState("error");
    }
  }, []);

  // Fetch available slots from edge function
  const fetchAvailableSlots = async (bookingToken: string) => {
    setIsLoadingSlots(true);
    try {
      const { data, error } = await supabase.functions.invoke("public-available-slots", {
        body: { 
          token: bookingToken,
          clientTimezone,
        },
      });

      if (error) {
        console.error("Error fetching slots:", error);
        setAvailableSlots([]);
        return;
      }

      const slots = data?.slots || [];
      setAvailableSlots(slots);
      
      if (slots.length === 0) {
        setCurrentState("no_available_times");
      }
    } catch (err) {
      console.error("Error fetching slots:", err);
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

  const scrollToSlots = () => {
    slotSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  // Confirm booking
  const handleConfirmSlot = async () => {
    if (!selectedSlot || !token) return;

    setConfirming(true);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("confirm-booking", {
        body: {
          token,
          startDatetime: selectedSlot.start,
          endDatetime: selectedSlot.end,
        },
      });

      if (invokeError) {
        throw new Error(invokeError.message || "Failed to confirm booking");
      }

      // Capture lawmatics debug data if present
      if (data?.lawmatics_debug) {
        setLawmaticsDebug(data.lawmatics_debug);
      }

      if (data?.success) {
        // Update meeting state with confirmed times
        setMeeting(prev => prev ? {
          ...prev,
          startDatetime: selectedSlot.start,
          endDatetime: selectedSlot.end,
        } : null);
        
        toast({
          title: "Meeting Confirmed!",
          description: "Your meeting has been scheduled successfully.",
        });
        
        // Show the already_booked state with debug button instead of navigating away
        setCurrentState("already_booked");
      } else if (data?.error) {
        if (data.error.toLowerCase().includes("already")) {
          setCurrentState("already_booked");
          return;
        }
        throw new Error(data.error);
      } else {
        throw new Error("Unexpected response from server");
      }
    } catch (err: any) {
      console.error("Booking confirmation error:", err);
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
      <ErrorState
        message={errorMessage}
        onRetry={handleRetry}
        isRetrying={isRetrying}
        contactEmail={contact.email}
        contactPhone={contact.phone}
      />
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
          
          {/* Debug button for staff to view Lawmatics integration details */}
          {lawmaticsDebug && (
            <div className="flex justify-center">
              <LawmaticsDebugButton debug={lawmaticsDebug} />
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

  if (currentState === "no_available_times") {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Schedule Your Meeting</h1>
            <p className="text-muted-foreground mt-1">
              {meeting?.meetingTypeName || "Meeting"} • {meeting?.durationMinutes} minutes
            </p>
          </div>
          
          <NoAvailableTimesState
            onTryPreviousWeek={() => {}}
            onTryNextWeek={() => {}}
            onRefresh={handleRefreshSlots}
            canGoPrevious={false}
            canGoNext={true}
            isRefreshing={isLoadingSlots}
            contactEmail={contact.email}
            contactPhone={contact.phone}
            contactMessage={contact.message}
          />
        </div>
      </div>
    );
  }

  // Main scheduling view (needs_scheduling state)
  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Schedule Your Meeting</h1>
          <p className="text-muted-foreground mt-1">Select a time that works best for you</p>
        </div>

        {/* Guided Help Panel */}
        <GuidedHelpPanel
          onGetStarted={scrollToSlots}
          clientTimezone={clientTimezone}
          contactEmail={contact.email}
          contactPhone={contact.phone}
        />

        {/* Meeting Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {meeting?.meetingTypeName || "Meeting"}
            </CardTitle>
            <CardDescription>Meeting Details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{meeting?.durationMinutes} minutes</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {meeting?.locationMode === "Zoom" ? (
                <Video className="h-4 w-4 text-muted-foreground" />
              ) : (
                <MapPin className="h-4 w-4 text-muted-foreground" />
              )}
              <span>{getLocationDisplay()}</span>
            </div>
          </CardContent>
        </Card>

        {/* Timezone Selector */}
        <div className="flex justify-center">
          <TimezoneSelector 
            timezone={clientTimezone} 
            onTimezoneChange={setClientTimezone} 
          />
        </div>

        {/* Available Slots */}
        <Card ref={slotSectionRef}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Available Times
                </CardTitle>
                <CardDescription>Choose a time slot below</CardDescription>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => token && fetchAvailableSlots(token)}
                disabled={isLoadingSlots}
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingSlots ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingSlots ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
                ))}
              </div>
            ) : availableSlots.length > 0 ? (
              <div className="space-y-2">
                {availableSlots.map((slot, index) => (
                  <Button
                    key={index}
                    variant={selectedSlot?.start === slot.start ? "default" : "outline"}
                    className="w-full justify-start text-left h-auto py-3"
                    onClick={() => setSelectedSlot(slot)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div>
                        <div className="font-medium">
                          {format(new Date(slot.start), "EEEE, MMMM d")}
                        </div>
                        <div className="text-sm opacity-80">
                          {format(new Date(slot.start), "h:mm a")}
                        </div>
                      </div>
                      {selectedSlot?.start === slot.start && (
                        <CheckCircle className="h-5 w-5" />
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            ) : (
              <NoAvailableTimesState
                onTryPreviousWeek={() => {}}
                onTryNextWeek={() => {}}
                onRefresh={handleRefreshSlots}
                canGoPrevious={false}
                canGoNext={true}
                isRefreshing={isLoadingSlots}
                contactEmail={contact.email}
                contactPhone={contact.phone}
                contactMessage={contact.message}
              />
            )}
          </CardContent>
        </Card>

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
