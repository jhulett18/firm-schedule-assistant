import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Clock, 
  MapPin, 
  Video, 
  Calendar, 
  RefreshCw, 
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

interface BookClientNowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meeting: {
    id: string;
    meeting_types: { name: string } | null;
    duration_minutes: number;
    location_mode: string;
    booking_requests: { public_token: string }[] | null;
  } | null;
  onSuccess?: () => void;
}

export function BookClientNowDialog({
  open,
  onOpenChange,
  meeting,
  onSuccess,
}: BookClientNowDialogProps) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [clientTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );

  const bookingToken = meeting?.booking_requests?.[0]?.public_token;

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open && bookingToken) {
      setSlots([]);
      setSelectedSlot(null);
      setError(null);
      setWarnings([]);
      setIsSuccess(false);
      fetchSlots();
    }
  }, [open, bookingToken]);

  const fetchSlots = async () => {
    if (!bookingToken) return;
    
    setIsLoadingSlots(true);
    setError(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "public-available-slots",
        {
          body: { token: bookingToken, clientTimezone },
        }
      );

      if (invokeError) {
        throw new Error(invokeError.message || "Failed to load available slots");
      }

      const fetchedSlots = Array.isArray(data?.slots) ? data.slots : [];
      setSlots(fetchedSlots);

      if (fetchedSlots.length === 0) {
        setError("No available times found. The calendars may be fully booked.");
      }
    } catch (err: any) {
      console.error("Error fetching slots:", err);
      setError(err.message || "Failed to load available slots");
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedSlot || !meeting) return;

    setIsConfirming(true);
    setError(null);
    setWarnings([]);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("You must be logged in to book on behalf of a client");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-booking-staff`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            meetingId: meeting.id,
            startDatetime: selectedSlot.start,
            endDatetime: selectedSlot.end,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      if (data.success === true) {
        // Capture warnings if present
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setWarnings(data.warnings);
        }

        setIsSuccess(true);
        toast.success("Meeting booked successfully!");
        onSuccess?.();
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error("Unexpected response from server");
      }
    } catch (err: any) {
      console.error("Error confirming booking:", err);
      setError(err.message || "Failed to confirm booking");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  if (!meeting) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Book Client Now</DialogTitle>
          <DialogDescription>
            Select a time slot to book this meeting on behalf of the client
          </DialogDescription>
        </DialogHeader>

        {/* Meeting Summary */}
        <div className="space-y-2 border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{meeting.meeting_types?.name || "Meeting"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{meeting.duration_minutes} minutes</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {meeting.location_mode === "Zoom" ? (
              <>
                <Video className="h-4 w-4 text-muted-foreground" />
                <span>Video Call</span>
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>In-Person</span>
              </>
            )}
          </div>
        </div>

        {/* Success State */}
        {isSuccess ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">Meeting Booked!</h3>
              <p className="text-muted-foreground text-sm">
                {selectedSlot && format(new Date(selectedSlot.start), "EEEE, MMMM d 'at' h:mm a")}
              </p>
            </div>
            
            {warnings.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-1 text-sm">
                    Booking confirmed with warnings:
                  </p>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            <Button onClick={handleClose} className="mt-2">
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Error State */}
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Loading State */}
            {isLoadingSlots ? (
              <div className="space-y-3 py-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : slots.length > 0 ? (
              <>
                {/* Slot Selection */}
                <div className="flex-1 min-h-0">
                  <p className="text-sm text-muted-foreground mb-2">
                    Available times ({clientTimezone})
                  </p>
                  <ScrollArea className="h-[280px] pr-4">
                    <div className="space-y-2">
                      {slots.map((slot, index) => {
                        const slotDate = new Date(slot.start);
                        const isSelected = selectedSlot?.start === slot.start;
                        
                        return (
                          <Button
                            key={index}
                            variant={isSelected ? "default" : "outline"}
                            className="w-full justify-start h-auto py-3"
                            onClick={() => setSelectedSlot(slot)}
                          >
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="font-medium">
                                {format(slotDate, "EEEE, MMMM d")}
                              </span>
                              <span className="text-sm opacity-80">
                                {format(slotDate, "h:mm a")}
                              </span>
                            </div>
                          </Button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={fetchSlots}
                    disabled={isLoadingSlots || isConfirming}
                    className="flex-shrink-0"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingSlots ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={!selectedSlot || isConfirming}
                    className="flex-1"
                  >
                    {isConfirming ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Booking...
                      </>
                    ) : (
                      "Confirm Booking"
                    )}
                  </Button>
                </div>
              </>
            ) : !error ? (
              <div className="py-8 text-center text-muted-foreground">
                <p>No slots loaded yet</p>
                <Button variant="outline" onClick={fetchSlots} className="mt-2">
                  Load Available Times
                </Button>
              </div>
            ) : (
              <div className="py-4 flex justify-center">
                <Button variant="outline" onClick={fetchSlots}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
