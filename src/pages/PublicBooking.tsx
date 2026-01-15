import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, MapPin, Video, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { LoadingState } from "@/components/public-booking/LoadingState";
import { GuidedHelpPanel } from "@/components/public-booking/GuidedHelpPanel";
import { NoAvailableTimesState } from "@/components/public-booking/NoAvailableTimesState";
import { AlreadyBookedState } from "@/components/public-booking/AlreadyBookedState";
import { ExpiredOrCancelledState } from "@/components/public-booking/ExpiredOrCancelledState";
import { ErrorState } from "@/components/public-booking/ErrorState";
import { TimezoneSelector } from "@/components/public-booking/TimezoneSelector";

// Types for the state machine
type BookingState = 
  | "loading" 
  | "needs_scheduling" 
  | "no_available_times" 
  | "already_booked" 
  | "expired_or_cancelled" 
  | "error";

interface BookingRequest {
  id: string;
  meeting_id: string;
  public_token: string;
  expires_at: string;
  status: "Open" | "Completed" | "Expired";
  created_at: string;
}

interface MeetingData {
  id: string;
  duration_minutes: number;
  location_mode: "Zoom" | "InPerson";
  in_person_location_choice: string | null;
  status: string;
  start_datetime: string | null;
  end_datetime: string | null;
  timezone: string;
  meeting_types: { name: string } | null;
}

interface ContactSettings {
  phone?: string;
  email?: string;
  message?: string;
}

// Mock available slots for now - will be replaced with real availability logic
function generateMockSlots(): Date[] {
  const slots: Date[] = [];
  const now = new Date();
  
  // Generate slots for the next 10 days
  for (let day = 2; day <= 10; day++) {
    const date = new Date(now);
    date.setDate(date.getDate() + day);
    
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    // Add 2-3 slots per day
    const hours = [9, 11, 14, 16];
    const slotsPerDay = Math.floor(Math.random() * 2) + 2;
    const selectedHours = hours.slice(0, slotsPerDay);
    
    for (const hour of selectedHours) {
      const slot = new Date(date);
      slot.setHours(hour, 0, 0, 0);
      slots.push(slot);
    }
  }
  
  return slots;
}

export default function PublicBooking() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const slotSectionRef = useRef<HTMLDivElement>(null);
  
  // State machine state
  const [currentState, setCurrentState] = useState<BookingState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("Something went wrong");
  const [expiredReason, setExpiredReason] = useState<"expired" | "cancelled">("expired");
  
  // Data states
  const [bookingRequest, setBookingRequest] = useState<BookingRequest | null>(null);
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [contactSettings, setContactSettings] = useState<ContactSettings>({});
  const [availableSlots, setAvailableSlots] = useState<Date[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  
  // UI states
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clientTimezone, setClientTimezone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );
  const [isRetrying, setIsRetrying] = useState(false);

  // Fetch contact settings from app_settings
  const fetchContactSettings = useCallback(async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["public_contact_phone", "public_contact_email", "public_contact_message"]);
    
    if (data) {
      const settings: ContactSettings = {};
      data.forEach(item => {
        if (item.key === "public_contact_phone") settings.phone = item.value;
        if (item.key === "public_contact_email") settings.email = item.value;
        if (item.key === "public_contact_message") settings.message = item.value;
      });
      setContactSettings(settings);
    }
  }, []);

  // Fetch booking data
  const fetchBookingData = useCallback(async () => {
    if (!token) {
      setErrorMessage("Invalid booking link");
      setCurrentState("error");
      return;
    }

    try {
      // Fetch booking request by token
      const { data: requestData, error: requestError } = await supabase
        .from("booking_requests")
        .select("*")
        .eq("public_token", token)
        .maybeSingle();

      if (requestError || !requestData) {
        setErrorMessage("This booking link was not found. Please check the link or contact our office.");
        setCurrentState("error");
        return;
      }

      const request = requestData as BookingRequest;
      setBookingRequest(request);

      // Fetch meeting details (limited info for client)
      const { data: meetingData, error: meetingError } = await supabase
        .from("meetings")
        .select(`
          id,
          duration_minutes,
          location_mode,
          in_person_location_choice,
          status,
          start_datetime,
          end_datetime,
          timezone,
          meeting_types (name)
        `)
        .eq("id", request.meeting_id)
        .maybeSingle();

      if (meetingError || !meetingData) {
        setErrorMessage("Meeting details could not be loaded. Please try again or contact our office.");
        setCurrentState("error");
        return;
      }

      const meetingInfo = meetingData as MeetingData;
      setMeeting(meetingInfo);

      // Determine state based on booking request and meeting status
      // Check for already booked
      if (request.status === "Completed" || meetingInfo.status === "Booked") {
        setCurrentState("already_booked");
        return;
      }

      // Check expiration
      if (new Date(request.expires_at) < new Date() || request.status === "Expired") {
        setExpiredReason("expired");
        setCurrentState("expired_or_cancelled");
        return;
      }

      // Check cancelled (if meeting status indicates cancellation)
      if (meetingInfo.status === "Cancelled") {
        setExpiredReason("cancelled");
        setCurrentState("expired_or_cancelled");
        return;
      }

      // Booking is open - needs scheduling
      setCurrentState("needs_scheduling");
      
      // Load available slots
      await fetchAvailableSlots();
      
    } catch (err) {
      console.error("Error fetching booking data:", err);
      setErrorMessage("An unexpected error occurred. Please try again.");
      setCurrentState("error");
    }
  }, [token]);

  // Fetch available time slots
  const fetchAvailableSlots = async () => {
    setIsLoadingSlots(true);
    try {
      // TODO: Replace with actual edge function call to get-available-slots
      // For now, use mock slots
      await new Promise(resolve => setTimeout(resolve, 800)); // Simulate API call
      const slots = generateMockSlots();
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
    fetchContactSettings();
    fetchBookingData();
  }, [fetchContactSettings, fetchBookingData]);

  // Scroll to slot section
  const scrollToSlots = () => {
    slotSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Handle retry
  const handleRetry = async () => {
    setIsRetrying(true);
    setCurrentState("loading");
    await fetchBookingData();
    setIsRetrying(false);
  };

  // Handle refresh slots
  const handleRefreshSlots = async () => {
    await fetchAvailableSlots();
    if (availableSlots.length > 0) {
      setCurrentState("needs_scheduling");
    }
  };

  // Confirm booking
  async function handleConfirmSlot() {
    if (!selectedSlot || !bookingRequest || !meeting) return;

    setConfirming(true);

    try {
      const endTime = new Date(selectedSlot.getTime() + meeting.duration_minutes * 60 * 1000);

      const { data, error: invokeError } = await supabase.functions.invoke("confirm-booking", {
        body: {
          token,
          startDatetime: selectedSlot.toISOString(),
          endDatetime: endTime.toISOString(),
        },
      });

      if (invokeError) {
        throw new Error(invokeError.message || "Failed to confirm booking");
      }

      if (data?.success) {
        // Update local state to show already booked
        setMeeting(prev => prev ? { ...prev, status: "Booked", start_datetime: selectedSlot.toISOString(), end_datetime: endTime.toISOString() } : null);
        setCurrentState("already_booked");
        toast({
          title: "Meeting Confirmed!",
          description: "Your meeting has been scheduled successfully.",
        });
      } else if (data?.error) {
        // Check if already booked
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
  }

  function getLocationDisplay() {
    if (!meeting) return "";
    if (meeting.location_mode === "Zoom") {
      return "Video call (link will be sent via email)";
    }
    switch (meeting.in_person_location_choice) {
      case "RoomA":
      case "RoomB":
      case "AttorneyOffice":
        return "In-person at our office";
      default:
        return "In-person at our office";
    }
  }

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
        contactEmail={contactSettings.email}
        contactPhone={contactSettings.phone}
      />
    );
  }

  if (currentState === "expired_or_cancelled") {
    return (
      <ExpiredOrCancelledState
        reason={expiredReason}
        contactEmail={contactSettings.email}
        contactPhone={contactSettings.phone}
        contactMessage={contactSettings.message}
      />
    );
  }

  // Handle reschedule - transition back to scheduling mode
  const handleReschedule = () => {
    setCurrentState("needs_scheduling");
    fetchAvailableSlots();
  };

  // Handle cancelled - show expired/cancelled state
  const handleCancelled = () => {
    setExpiredReason("cancelled");
    setCurrentState("expired_or_cancelled");
  };

  if (currentState === "already_booked" && meeting) {
    const startDate = meeting.start_datetime ? new Date(meeting.start_datetime) : new Date();
    return (
      <AlreadyBookedState
        meetingTypeName={meeting.meeting_types?.name || "Meeting"}
        startDatetime={startDate}
        durationMinutes={meeting.duration_minutes}
        locationMode={meeting.location_mode}
        locationDisplay={getLocationDisplay()}
        contactEmail={contactSettings.email}
        contactPhone={contactSettings.phone}
        token={token}
        onReschedule={handleReschedule}
        onCancelled={handleCancelled}
      />
    );
  }

  if (currentState === "no_available_times") {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Schedule Your Meeting</h1>
            <p className="text-muted-foreground mt-1">
              {meeting?.meeting_types?.name || "Meeting"} • {meeting?.duration_minutes} minutes
            </p>
          </div>
          
          <NoAvailableTimesState
            onTryPreviousWeek={() => {}}
            onTryNextWeek={() => {}}
            onRefresh={handleRefreshSlots}
            canGoPrevious={false}
            canGoNext={true}
            isRefreshing={isLoadingSlots}
            contactEmail={contactSettings.email}
            contactPhone={contactSettings.phone}
            contactMessage={contactSettings.message}
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

        {/* Guided Help Panel - shown immediately */}
        <GuidedHelpPanel
          onGetStarted={scrollToSlots}
          clientTimezone={clientTimezone}
          contactEmail={contactSettings.email}
          contactPhone={contactSettings.phone}
        />

        {/* Meeting Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {meeting?.meeting_types?.name || "Meeting"}
            </CardTitle>
            <CardDescription>Meeting Details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{meeting?.duration_minutes} minutes</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {meeting?.location_mode === "Zoom" ? (
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
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Available Times
            </CardTitle>
            <CardDescription>Choose a time slot below</CardDescription>
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
                    variant={selectedSlot?.getTime() === slot.getTime() ? "default" : "outline"}
                    className="w-full justify-start text-left h-auto py-3"
                    onClick={() => setSelectedSlot(slot)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div>
                        <div className="font-medium">
                          {format(slot, "EEEE, MMMM d")}
                        </div>
                        <div className="text-sm opacity-80">
                          {format(slot, "h:mm a")}
                        </div>
                      </div>
                      {selectedSlot?.getTime() === slot.getTime() && (
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
                contactEmail={contactSettings.email}
                contactPhone={contactSettings.phone}
                contactMessage={contactSettings.message}
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

        {/* Footer */}
        {bookingRequest && (
          <p className="text-xs text-center text-muted-foreground">
            Link expires {format(new Date(bookingRequest.expires_at), "MMMM d, yyyy 'at' h:mm a")}
          </p>
        )}
      </div>
    </div>
  );
}
