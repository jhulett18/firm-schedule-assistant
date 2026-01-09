import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Video, 
  CheckCircle, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  AlertCircle,
  TestTube,
  Terminal
} from "lucide-react";
import { format } from "date-fns";

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

interface ProgressLog {
  id: string;
  step: string;
  level: string;
  message: string;
  details_json: any;
  created_at: string;
}

interface TestMyBookingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type WizardStep = "calendar" | "options" | "availability" | "confirm" | "processing" | "done";

export function TestMyBookingWizard({ open, onOpenChange }: TestMyBookingWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("calendar");
  
  // Step 1: Calendar selection
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("");
  const [calendars, setCalendars] = useState<any[]>([]);
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
  
  // Step 2: Options
  const [selectedMeetingTypeId, setSelectedMeetingTypeId] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [locationMode, setLocationMode] = useState<"Zoom" | "InPerson">("Zoom");
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [sendInvites, setSendInvites] = useState(false);
  
  // Step 3: Availability
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  
  // Step 4+: Booking
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [bookingResult, setBookingResult] = useState<any>(null);
  
  // Fetch meeting types
  const { data: meetingTypes } = useQuery({
    queryKey: ["meeting-types-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_types")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });
  
  // Fetch rooms
  const { data: rooms } = useQuery({
    queryKey: ["rooms-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });
  
  // Load calendars on open
  useEffect(() => {
    if (open && currentStep === "calendar" && calendars.length === 0) {
      loadCalendars();
    }
  }, [open, currentStep]);
  
  // Subscribe to progress logs
  useEffect(() => {
    if (!meetingId || !runId || currentStep !== "processing") return;
    
    // Initial fetch
    fetchProgressLogs();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel(`progress-${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "booking_progress_logs",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          const newLog = payload.new as ProgressLog;
          setProgressLogs((prev) => [...prev, newLog]);
          
          // Check if done
          if (newLog.step === "done") {
            setTimeout(() => setCurrentStep("done"), 500);
          }
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId, runId, currentStep]);
  
  const fetchProgressLogs = async () => {
    if (!meetingId || !runId) return;
    
    const { data } = await supabase
      .from("booking_progress_logs")
      .select("*")
      .eq("meeting_id", meetingId)
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    
    if (data) {
      setProgressLogs(data);
      const doneLog = data.find((l) => l.step === "done");
      if (doneLog) {
        setCurrentStep("done");
      }
    }
  };
  
  const loadCalendars = async () => {
    setIsLoadingCalendars(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      
      const { data, error } = await supabase.functions.invoke("google-list-calendars", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      
      if (error) throw error;
      
      setCalendars(data?.calendars || []);
      
      // Auto-select primary if available
      const primary = data?.calendars?.find((c: any) => c.primary);
      if (primary) {
        setSelectedCalendarId(primary.id);
      }
    } catch (err) {
      toast.error("Failed to load calendars");
      console.error(err);
    } finally {
      setIsLoadingCalendars(false);
    }
  };
  
  const handleNextFromCalendar = () => {
    if (!selectedCalendarId) {
      toast.error("Please select a calendar");
      return;
    }
    setCurrentStep("options");
  };
  
  const handleNextFromOptions = async () => {
    if (!selectedMeetingTypeId) {
      toast.error("Please select a meeting type");
      return;
    }
    if (locationMode === "InPerson" && !selectedRoomId && rooms && rooms.length > 0) {
      toast.error("Please select a room");
      return;
    }
    
    // Create test booking request
    try {
      setIsLoadingSlots(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      
      const { data, error } = await supabase.functions.invoke("create-test-booking-request", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          meetingTypeId: selectedMeetingTypeId,
          durationMinutes,
          locationMode,
          roomId: locationMode === "InPerson" ? selectedRoomId : undefined,
          adminCalendarId: selectedCalendarId,
          sendInvites,
        },
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to create test booking");
      
      setMeetingId(data.meetingId);
      
      // Load available slots
      await loadAvailableSlots(data.meetingId);
      setCurrentStep("availability");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create booking");
      console.error(err);
    } finally {
      setIsLoadingSlots(false);
    }
  };
  
  const loadAvailableSlots = async (mId: string) => {
    setIsLoadingSlots(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      
      const { data, error } = await supabase.functions.invoke("test-booking-available-slots", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { meetingId: mId },
      });
      
      if (error) throw error;
      setAvailableSlots(data?.slots || []);
    } catch (err) {
      toast.error("Failed to load available slots");
      console.error(err);
    } finally {
      setIsLoadingSlots(false);
    }
  };
  
  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setCurrentStep("confirm");
  };
  
  const handleConfirmBooking = async () => {
    if (!selectedSlot || !meetingId) return;
    
    const newRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setRunId(newRunId);
    setProgressLogs([]);
    setCurrentStep("processing");
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      
      const { data, error } = await supabase.functions.invoke("confirm-test-booking", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          meetingId,
          startDatetime: selectedSlot.start,
          endDatetime: selectedSlot.end,
          runId: newRunId,
        },
      });
      
      if (error) throw error;
      setBookingResult(data);
      
      if (!data?.success) {
        toast.error(data?.error || "Booking failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Booking failed");
      console.error(err);
      setCurrentStep("confirm");
    }
  };
  
  const handleClose = () => {
    // Reset state
    setCurrentStep("calendar");
    setSelectedCalendarId("");
    setSelectedMeetingTypeId("");
    setDurationMinutes(60);
    setLocationMode("Zoom");
    setSelectedRoomId("");
    setSendInvites(false);
    setAvailableSlots([]);
    setSelectedSlot(null);
    setMeetingId(null);
    setRunId("");
    setProgressLogs([]);
    setBookingResult(null);
    onOpenChange(false);
  };
  
  const getLogIcon = (level: string) => {
    switch (level) {
      case "success": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error": return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "warn": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default: return <Terminal className="h-4 w-4 text-muted-foreground" />;
    }
  };
  
  const selectedMeetingType = meetingTypes?.find((mt) => mt.id === selectedMeetingTypeId);
  const selectedRoom = rooms?.find((r) => r.id === selectedRoomId);
  const selectedCalendar = calendars.find((c) => c.id === selectedCalendarId);
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Test My Booking
            <Badge variant="secondary" className="ml-2">Admin Only</Badge>
          </DialogTitle>
        </DialogHeader>
        
        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-4">
          <span className={currentStep === "calendar" ? "text-primary font-medium" : ""}>1. Calendar</span>
          <ChevronRight className="h-4 w-4" />
          <span className={currentStep === "options" ? "text-primary font-medium" : ""}>2. Options</span>
          <ChevronRight className="h-4 w-4" />
          <span className={currentStep === "availability" ? "text-primary font-medium" : ""}>3. Availability</span>
          <ChevronRight className="h-4 w-4" />
          <span className={currentStep === "confirm" || currentStep === "processing" ? "text-primary font-medium" : ""}>4. Confirm</span>
        </div>
        
        <div className="flex-1 overflow-auto">
          {/* Step 1: Calendar Selection */}
          {currentStep === "calendar" && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Select which of your connected Google calendars to use for availability checking and event creation.
              </p>
              
              {isLoadingCalendars ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : calendars.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p>No Google calendars connected.</p>
                    <p className="text-sm text-muted-foreground">Please connect your Google Calendar in Settings first.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  <Label>Select Calendar</Label>
                  <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a calendar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {calendars.map((cal) => (
                        <SelectItem key={cal.id} value={cal.id}>
                          {cal.summary} {cal.primary && "(Primary)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <div className="flex justify-end pt-4">
                <Button onClick={handleNextFromCalendar} disabled={!selectedCalendarId || isLoadingCalendars}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 2: Options */}
          {currentStep === "options" && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Meeting Type</Label>
                <Select value={selectedMeetingTypeId} onValueChange={setSelectedMeetingTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select meeting type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {meetingTypes?.map((mt) => (
                      <SelectItem key={mt.id} value={mt.id}>{mt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Select value={String(durationMinutes)} onValueChange={(v) => setDurationMinutes(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="45">45 minutes</SelectItem>
                    <SelectItem value="60">60 minutes</SelectItem>
                    <SelectItem value="90">90 minutes</SelectItem>
                    <SelectItem value="120">120 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={locationMode} onValueChange={(v) => setLocationMode(v as "Zoom" | "InPerson")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Zoom">
                      <div className="flex items-center gap-2">
                        <Video className="h-4 w-4" /> Zoom
                      </div>
                    </SelectItem>
                    <SelectItem value="InPerson">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" /> In Person
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {locationMode === "InPerson" && rooms && rooms.length > 0 && (
                <div className="space-y-2">
                  <Label>Room</Label>
                  <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select room..." />
                    </SelectTrigger>
                    <SelectContent>
                      {rooms.map((room) => (
                        <SelectItem key={room.id} value={room.id}>{room.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Send Email Invites</Label>
                  <p className="text-sm text-muted-foreground">
                    Send calendar invites to attendees (including yourself)
                  </p>
                </div>
                <Switch checked={sendInvites} onCheckedChange={setSendInvites} />
              </div>
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep("calendar")}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button onClick={handleNextFromOptions} disabled={!selectedMeetingTypeId || isLoadingSlots}>
                  {isLoadingSlots ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 3: Availability */}
          {currentStep === "availability" && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Select an available time slot. Availability is based on your selected calendar: <strong>{selectedCalendar?.summary}</strong>
              </p>
              
              {isLoadingSlots ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : availableSlots.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center">
                    <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p>No available slots found.</p>
                    <p className="text-sm text-muted-foreground">Your calendar may be fully booked.</p>
                  </CardContent>
                </Card>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2 pr-4">
                    {availableSlots.map((slot, idx) => (
                      <Button
                        key={idx}
                        variant="outline"
                        className="w-full justify-start h-auto py-3"
                        onClick={() => handleSelectSlot(slot)}
                      >
                        <div className="text-left">
                          <div className="font-medium">
                            {format(new Date(slot.start), "EEEE, MMMM d")}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(slot.start), "h:mm a")} - {format(new Date(slot.end), "h:mm a")}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              )}
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep("options")}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 4: Confirm */}
          {currentStep === "confirm" && selectedSlot && (
            <div className="space-y-4 py-4">
              <Card className="border-primary">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TestTube className="h-5 w-5" />
                    Test Booking Summary
                  </CardTitle>
                  <CardDescription>
                    This is a TEST booking. Records will be marked with [TEST].
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{format(new Date(selectedSlot.start), "EEEE, MMMM d, yyyy")}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {format(new Date(selectedSlot.start), "h:mm a")} - {format(new Date(selectedSlot.end), "h:mm a")} ({durationMinutes} min)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {locationMode === "Zoom" ? (
                      <Video className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>{locationMode === "Zoom" ? "Zoom Video Call" : selectedRoom?.name || "In Person"}</span>
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-sm"><strong>Meeting Type:</strong> {selectedMeetingType?.name}</p>
                    <p className="text-sm"><strong>Calendar:</strong> {selectedCalendar?.summary}</p>
                    <p className="text-sm"><strong>Send Invites:</strong> {sendInvites ? "Yes" : "No"}</p>
                  </div>
                </CardContent>
              </Card>
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep("availability")}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button onClick={handleConfirmBooking}>
                  Confirm Test Booking
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 5: Processing */}
          {currentStep === "processing" && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing test booking...
              </div>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Progress Logs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[250px]">
                    <div className="space-y-2 pr-4 font-mono text-xs">
                      {progressLogs.length === 0 ? (
                        <p className="text-muted-foreground">Waiting for logs...</p>
                      ) : (
                        progressLogs.map((log) => (
                          <div key={log.id} className="flex items-start gap-2">
                            {getLogIcon(log.level)}
                            <span className="text-muted-foreground">
                              {format(new Date(log.created_at), "HH:mm:ss")}
                            </span>
                            <span className={log.level === "error" ? "text-red-500" : log.level === "success" ? "text-green-500" : ""}>
                              {log.message}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Step 6: Done */}
          {currentStep === "done" && (
            <div className="space-y-4 py-4">
              <div className="text-center py-4">
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-semibold">Test Booking Complete!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Check your Lawmatics and Google Calendar for the [TEST] marked entries.
                </p>
              </div>
              
              {bookingResult && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Results</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    {bookingResult.lawmaticsAppointmentId && (
                      <p><strong>Lawmatics ID:</strong> {bookingResult.lawmaticsAppointmentId}</p>
                    )}
                    {bookingResult.googleEventId && (
                      <p><strong>Google Event ID:</strong> {bookingResult.googleEventId}</p>
                    )}
                    {bookingResult.hasErrors && (
                      <p className="text-yellow-600">Some steps completed with warnings. Check logs above.</p>
                    )}
                  </CardContent>
                </Card>
              )}
              
              {/* Show final logs */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Execution Log
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2 pr-4 font-mono text-xs">
                      {progressLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-2">
                          {getLogIcon(log.level)}
                          <span className="text-muted-foreground">
                            {format(new Date(log.created_at), "HH:mm:ss")}
                          </span>
                          <span className={log.level === "error" ? "text-red-500" : log.level === "success" ? "text-green-500" : ""}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
              
              <div className="flex justify-end pt-4">
                <Button onClick={handleClose}>Close</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
