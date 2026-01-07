import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, MapPin, Video, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

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
  meeting_types: { name: string } | null;
}

// Mock available slots for now - will be replaced with real availability logic
const mockSlots = [
  new Date(Date.now() + 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 60 * 10), // 2 days, 10am
  new Date(Date.now() + 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 60 * 14), // 2 days, 2pm
  new Date(Date.now() + 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 60 * 11), // 3 days, 11am
  new Date(Date.now() + 1000 * 60 * 60 * 24 * 4 + 1000 * 60 * 60 * 15), // 4 days, 3pm
  new Date(Date.now() + 1000 * 60 * 60 * 24 * 5 + 1000 * 60 * 60 * 9),  // 5 days, 9am
];

export default function PublicBooking() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingRequest, setBookingRequest] = useState<BookingRequest | null>(null);
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [bookingFailed, setBookingFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Invalid booking link");
      setLoading(false);
      return;
    }
    fetchBookingData();
  }, [token]);

  async function fetchBookingData() {
    // Fetch booking request by token
    const { data: requestData, error: requestError } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();

    if (requestError || !requestData) {
      setError("Booking link not found or invalid");
      setLoading(false);
      return;
    }

    const request = requestData as BookingRequest;

    // Check expiration
    if (new Date(request.expires_at) < new Date()) {
      setError("This booking link has expired");
      setLoading(false);
      return;
    }

    // Check status
    if (request.status === "Completed") {
      setError("This meeting has already been scheduled");
      setLoading(false);
      return;
    }

    if (request.status === "Expired") {
      setError("This booking link has expired");
      setLoading(false);
      return;
    }

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
        meeting_types (name)
      `)
      .eq("id", request.meeting_id)
      .maybeSingle();

    if (meetingError || !meetingData) {
      setError("Meeting details not found");
      setLoading(false);
      return;
    }

    setMeeting(meetingData as MeetingData);
    setLoading(false);
  }

  async function handleConfirmSlot() {
    if (!selectedSlot || !bookingRequest || !meeting) return;

    setConfirming(true);
    setBookingFailed(false);
    setFailureMessage(null);

    try {
      // Calculate end time based on duration
      const endTime = new Date(selectedSlot.getTime() + meeting.duration_minutes * 60 * 1000);

      // Call the confirm-booking edge function
      const { data, error: invokeError } = await supabase.functions.invoke("confirm-booking", {
        body: {
          token,
          startDatetime: selectedSlot.toISOString(),
          endDatetime: endTime.toISOString(),
        },
      });

      if (invokeError) {
        console.error("Error confirming booking:", invokeError);
        throw new Error(invokeError.message || "Failed to confirm booking");
      }

      if (data?.success) {
        setConfirmed(true);
        toast({
          title: "Meeting Confirmed!",
          description: "Your meeting has been scheduled successfully.",
        });
      } else if (data?.error) {
        // Booking failed (e.g., Lawmatics error)
        setBookingFailed(true);
        setFailureMessage(data.error);
      } else {
        throw new Error("Unexpected response from server");
      }
    } catch (err) {
      console.error("Booking confirmation error:", err);
      setBookingFailed(true);
      setFailureMessage("We were unable to complete your booking. Please contact us directly to schedule your meeting.");
      toast({
        title: "Booking Failed",
        description: "Please contact us directly to schedule your meeting.",
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  }

  function getLocationDisplay() {
    if (!meeting) return "";
    if (meeting.location_mode === "Zoom") {
      return "Video call (Zoom link will be sent via email)";
    }
    switch (meeting.in_person_location_choice) {
      case "RoomA":
        return "In-person at our office - Conference Room A";
      case "RoomB":
        return "In-person at our office - Conference Room B";
      case "AttorneyOffice":
        return "In-person at our office";
      default:
        return "In-person at our office";
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Load</h2>
                <p className="text-muted-foreground">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (bookingFailed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <XCircle className="h-12 w-12 text-destructive" />
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Complete Booking</h2>
                <p className="text-muted-foreground">
                  {failureMessage || "We encountered an issue while scheduling your meeting."}
                </p>
                <p className="text-muted-foreground mt-4">
                  Please contact us directly at <strong>your-office@email.com</strong> or call <strong>(555) 123-4567</strong> to schedule your meeting.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setBookingFailed(false);
                  setFailureMessage(null);
                  setSelectedSlot(null);
                }}
                className="mt-2"
              >
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <CheckCircle className="h-12 w-12 text-green-600" />
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">Meeting Confirmed!</h2>
                <p className="text-muted-foreground">
                  Your meeting is scheduled for{" "}
                  <strong>{format(selectedSlot!, "EEEE, MMMM d 'at' h:mm a")}</strong>.
                </p>
                <p className="text-muted-foreground mt-2">
                  You will receive a confirmation email with all the details.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Schedule Your Meeting</h1>
          <p className="text-muted-foreground mt-1">Select a time that works best for you</p>
        </div>

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

        {/* Available Slots */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Available Times
            </CardTitle>
            <CardDescription>Choose a time slot below</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mockSlots.map((slot, index) => (
                <Button
                  key={index}
                  variant={selectedSlot?.getTime() === slot.getTime() ? "default" : "outline"}
                  className="w-full justify-start text-left h-auto py-3"
                  onClick={() => setSelectedSlot(slot)}
                >
                  <div>
                    <div className="font-medium">
                      {format(slot, "EEEE, MMMM d")}
                    </div>
                    <div className="text-sm opacity-80">
                      {format(slot, "h:mm a")}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
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
        <p className="text-xs text-center text-muted-foreground">
          Link expires {format(new Date(bookingRequest!.expires_at), "MMMM d, yyyy 'at' h:mm a")}
        </p>
      </div>
    </div>
  );
}
