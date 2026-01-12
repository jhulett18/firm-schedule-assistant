import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  ChevronDown,
  AlertCircle,
  TestTube,
  Terminal,
  RotateCcw,
  Copy,
  Bug,
  XCircle
} from "lucide-react";
import { format } from "date-fns";
import { copyToClipboard } from "@/lib/clipboard";

// ========== EFFECTIVE STATUS HELPER (UI-ONLY) ==========
type EffectiveStatusTone = "success" | "warning" | "error";

interface EffectiveLawmaticsStatus {
  label: string;
  tone: EffectiveStatusTone;
  subtitle: string;
}

function getEffectiveLawmaticsStatus(result: any): EffectiveLawmaticsStatus {
  if (!result) {
    return { label: "Unknown", tone: "error", subtitle: "No result data available." };
  }

  const readback = result.lawmaticsReadback || result.lawmatics?.readback;
  const hasId = !!result.lawmaticsAppointmentId;
  
  // Check if times persisted in readback
  const hasPersistedTime = readback && (
    (readback.starts_at && readback.ends_at) ||
    (readback.start_time && readback.end_time)
  );

  if (hasId && hasPersistedTime) {
    return {
      label: "Created",
      tone: "success",
      subtitle: "Appointment created in Lawmatics."
    };
  }

  if (hasId && !hasPersistedTime) {
    return {
      label: "Created (incomplete)",
      tone: "warning",
      subtitle: "Created, but Lawmatics did not persist time fields. Check details."
    };
  }

  // No ID - check if lawmatics errors exist
  const hasLawmaticsError = result.errors?.some((e: any) => e.system === "lawmatics");
  if (hasLawmaticsError) {
    return {
      label: "Not created",
      tone: "error",
      subtitle: "Could not create Lawmatics appointment. See details."
    };
  }

  return {
    label: "Not created",
    tone: "error",
    subtitle: "Lawmatics appointment was not created."
  };
}

// ========== LOG ICON HELPER ==========
function getLogIcon(level: string) {
  switch (level) {
    case "success": return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "error": return <XCircle className="h-4 w-4 text-destructive" />;
    case "warn": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    default: return <Terminal className="h-4 w-4 text-muted-foreground" />;
  }
}

// ========== STATE MACHINE ==========
type FlowState = 
  | "idle"
  | "loading_calendars"
  | "creating_test_request"
  | "loading_availability"
  | "ready_to_select_slot"
  | "confirming"
  | "success"
  | "error"
  | "timeout";

type WizardStep = "calendar" | "options" | "availability" | "confirm" | "processing" | "done";

// ========== TIMEOUTS ==========
const TIMEOUTS = {
  calendars: 15000,
  create_test_request: 15000,
  availability: 20000,
  confirm_booking: 45000,
  polling_max: 60000,
};

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

// ========== CLIENT-SIDE LOG ENTRY ==========
interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: any;
}

interface DebugInfo {
  currentState: FlowState;
  lastAction: string;
  lastFunction: string;
  lastError: ErrorDetails | null;
  debugData: Record<string, any>;
}

interface ErrorDetails {
  functionName: string;
  statusCode?: number;
  message: string;
  responseExcerpt?: string;
  step?: string;
  timestamp: string;
}

interface TestMyBookingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestMyBookingWizard({ open, onOpenChange }: TestMyBookingWizardProps) {
  // ========== STATE ==========
  const [currentStep, setCurrentStep] = useState<WizardStep>("calendar");
  const [flowState, setFlowState] = useState<FlowState>("idle");
  
  // Debug info
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    currentState: "idle",
    lastAction: "none",
    lastFunction: "none",
    lastError: null,
    debugData: {},
  });
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  
  // Step 1: Calendar selection
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("");
  const [calendars, setCalendars] = useState<any[]>([]);
  
  // Step 2: Options
  const [selectedMeetingTypeId, setSelectedMeetingTypeId] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [locationMode, setLocationMode] = useState<"Zoom" | "InPerson">("Zoom");
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [sendInvites, setSendInvites] = useState(false);
  
  // Step 3: Availability
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [availabilityDebug, setAvailabilityDebug] = useState<Record<string, any>>({});
  
  // Step 4+: Booking
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [bookingResult, setBookingResult] = useState<any>(null);
  
  // ========== CLIENT-SIDE LOGS (ALWAYS-ON) ==========
  const [clientLogs, setClientLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  
  // Refs for cleanup
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingStartRef = useRef<number>(0);
  
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
  
  // ========== HELPERS ==========
  const updateDebug = useCallback((updates: Partial<DebugInfo>) => {
    setDebugInfo(prev => ({ ...prev, ...updates }));
  }, []);
  
  // ========== CLIENT-SIDE LOGGING ==========
  const appendLog = useCallback((level: LogEntry['level'], message: string, details?: any) => {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      message,
      details,
    };
    setClientLogs(prev => [...prev, entry]);
    console.log(`[TestMyBooking] [${level.toUpperCase()}] ${message}`, details || '');
  }, []);
  
  // Safe preview for logging (remove tokens, truncate)
  const safePreview = useCallback((body: any): any => {
    if (!body) return body;
    const str = JSON.stringify(body);
    if (str.length > 500) {
      return { _truncated: true, preview: str.slice(0, 500) + '...' };
    }
    // Remove tokens
    const sanitized = { ...body };
    if (sanitized.token) sanitized.token = '[REDACTED]';
    if (sanitized.access_token) sanitized.access_token = '[REDACTED]';
    return sanitized;
  }, []);
  
  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [clientLogs]);
  
  // Log on wizard open
  useEffect(() => {
    if (open && clientLogs.length === 0) {
      appendLog('info', 'Wizard opened');
    }
  }, [open, clientLogs.length, appendLog]);
  
  const setError = useCallback((functionName: string, error: any, step?: string) => {
    const errorDetails: ErrorDetails = {
      functionName,
      statusCode: error?.status || error?.statusCode,
      message: error?.message || String(error),
      responseExcerpt: typeof error === 'object' ? JSON.stringify(error).slice(0, 500) : String(error).slice(0, 500),
      step,
      timestamp: new Date().toISOString(),
    };
    
    setFlowState("error");
    updateDebug({
      currentState: "error",
      lastError: errorDetails,
      lastFunction: functionName,
      lastAction: `Error in ${functionName}`,
    });
    
    console.error(`[TestMyBooking] Error in ${functionName}:`, error);
  }, [updateDebug]);
  
  const setTimeout_ = useCallback((step: string, timeoutMs: number): AbortController => {
    // Cleanup previous
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    const timeoutId = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
        setFlowState("timeout");
        updateDebug({
          currentState: "timeout",
          lastAction: `Timeout after ${timeoutMs}ms`,
          lastError: {
            functionName: step,
            message: `Operation timed out after ${timeoutMs / 1000}s`,
            step,
            timestamp: new Date().toISOString(),
          },
        });
        toast.error(`${step} timed out after ${timeoutMs / 1000}s`);
      }
    }, timeoutMs);
    
    // Clear timeout if aborted early
    controller.signal.addEventListener('abort', () => {
      window.clearTimeout(timeoutId);
    });
    
    return controller;
  }, [updateDebug]);
  
  const clearAllTimeouts = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);
  
  // ========== RESET ==========
  const handleReset = useCallback(() => {
    clearAllTimeouts();
    appendLog('info', 'Reset clicked - clearing state');
    
    setCurrentStep("calendar");
    setFlowState("idle");
    setSelectedCalendarId("");
    setCalendars([]);
    setSelectedMeetingTypeId("");
    setDurationMinutes(60);
    setLocationMode("Zoom");
    setSelectedRoomId("");
    setSendInvites(false);
    setAvailableSlots([]);
    setSelectedSlot(null);
    setAvailabilityDebug({});
    setMeetingId(null);
    setRunId("");
    setProgressLogs([]);
    setBookingResult(null);
    setClientLogs([]); // Clear client logs
    
    setDebugInfo({
      currentState: "idle",
      lastAction: "Reset",
      lastFunction: "none",
      lastError: null,
      debugData: {},
    });
    
    toast.info("Test wizard reset");
  }, [clearAllTimeouts, appendLog]);
  
  // ========== COPY DEBUG REPORT ==========
  const handleCopyDebugReport = useCallback(async () => {
    const report = {
      timestamp: new Date().toISOString(),
      currentStep,
      flowState,
      selectedCalendarId,
      selectedMeetingTypeId,
      durationMinutes,
      locationMode,
      selectedRoomId,
      meetingId,
      runId,
      slotsCount: availableSlots.length,
      availabilityDebug,
      debugInfo,
      clientLogs, // Include client logs
      progressLogsCount: progressLogs.length,
      lastProgressLog: progressLogs[progressLogs.length - 1] || null,
    };
    
    const success = await copyToClipboard(JSON.stringify(report, null, 2));
    if (success) {
      toast.success("Debug report copied to clipboard");
    } else {
      toast.error("Failed to copy debug report");
    }
  }, [currentStep, flowState, selectedCalendarId, selectedMeetingTypeId, durationMinutes, locationMode, selectedRoomId, meetingId, runId, availableSlots, availabilityDebug, debugInfo, clientLogs, progressLogs]);
  
  // ========== COPY LOGS ==========
  const handleCopyLogs = useCallback(async () => {
    const success = await copyToClipboard(JSON.stringify(clientLogs, null, 2));
    if (success) {
      toast.success("Logs copied to clipboard");
    } else {
      toast.error("Failed to copy logs");
    }
  }, [clientLogs]);
  
  // ========== LOAD CALENDARS ==========
  const loadCalendars = useCallback(async () => {
    const functionName = "google-list-calendars";
    
    try {
      appendLog('info', `Flow state -> loading_calendars`);
      setFlowState("loading_calendars");
      updateDebug({ currentState: "loading_calendars", lastAction: "Loading calendars", lastFunction: functionName });
      
      appendLog('info', `Invoking ${functionName}`);
      const startedAt = Date.now();
      const controller = setTimeout_("calendars", TIMEOUTS.calendars);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        appendLog('error', `${functionName}: Not authenticated`);
        throw new Error("Not authenticated");
      }
      
      if (controller.signal.aborted) {
        appendLog('warn', `${functionName}: Aborted before call`);
        return;
      }
      
      const { data, error } = await supabase.functions.invoke(functionName, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      
      const ms = Date.now() - startedAt;
      
      if (controller.signal.aborted) {
        appendLog('warn', `${functionName}: Aborted after ${ms}ms`);
        return;
      }
      controller.abort(); // Clear timeout on success
      
      if (error) {
        appendLog('error', `${functionName} error after ${ms}ms`, { message: error.message });
        throw { message: error.message, status: error.status || 500, functionName };
      }
      
      // Handle structured response
      if (data?.ok === false) {
        appendLog('error', `${functionName} returned ok:false after ${ms}ms`, { error: data.error });
        throw { message: data.error?.message || "Unknown error", status: data.error?.status, functionName };
      }
      
      const calendarsData = data?.calendars || data?.data?.calendars || [];
      appendLog('info', `${functionName} success after ${ms}ms`, { 
        calendarsCount: calendarsData.length,
        keys: data ? Object.keys(data) : []
      });
      
      setCalendars(calendarsData);
      
      // Auto-select primary if available
      const primary = calendarsData.find((c: any) => c.primary);
      if (primary) {
        setSelectedCalendarId(primary.id);
        appendLog('info', `Auto-selected primary calendar: ${primary.summary}`);
      }
      
      appendLog('info', `Flow state -> idle`);
      setFlowState("idle");
      updateDebug({
        currentState: "idle",
        lastAction: `Loaded ${calendarsData.length} calendars`,
        debugData: { ...debugInfo.debugData, calendarsCount: calendarsData.length },
      });
      
    } catch (err: any) {
      if (flowState === "timeout") {
        appendLog('warn', 'Timeout already handled, skipping error');
        return;
      }
      appendLog('error', `${functionName} threw exception`, { message: err?.message || String(err) });
      setError(functionName, err, "loading_calendars");
    }
  }, [setTimeout_, setError, updateDebug, flowState, debugInfo.debugData, appendLog]);
  
  // Load calendars on open
  useEffect(() => {
    if (open && currentStep === "calendar" && calendars.length === 0 && flowState === "idle") {
      loadCalendars();
    }
  }, [open, currentStep, calendars.length, flowState, loadCalendars]);
  
  // ========== CREATE TEST REQUEST + LOAD AVAILABILITY ==========
  const handleNextFromOptions = useCallback(async () => {
    appendLog('info', 'Options selected, proceeding to create test booking', {
      meetingTypeId: selectedMeetingTypeId,
      durationMinutes,
      locationMode,
      roomId: selectedRoomId,
      calendarId: selectedCalendarId,
    });
    
    if (!selectedMeetingTypeId) {
      appendLog('warn', 'Missing meeting type');
      toast.error("Please select a meeting type");
      return;
    }
    if (locationMode === "InPerson" && !selectedRoomId && rooms && rooms.length > 0) {
      appendLog('warn', 'Missing room for in-person meeting');
      toast.error("Please select a room");
      return;
    }
    
    let createdMeetingId: string | null = null;
    
    // Step 1: Create test booking request
    const createFnName = "create-test-booking-request";
    try {
      appendLog('info', `Flow state -> creating_test_request`);
      setFlowState("creating_test_request");
      setCurrentStep("availability"); // Move to availability step immediately to show loading
      updateDebug({ currentState: "creating_test_request", lastAction: "Creating test request", lastFunction: createFnName });
      
      appendLog('info', `Invoking ${createFnName}`);
      const startedAt = Date.now();
      const controller = setTimeout_("create_test_request", TIMEOUTS.create_test_request);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        appendLog('error', `${createFnName}: Not authenticated`);
        throw new Error("Not authenticated");
      }
      
      if (controller.signal.aborted) {
        appendLog('warn', `${createFnName}: Aborted before call`);
        return;
      }
      
      const requestBody = {
        meetingTypeId: selectedMeetingTypeId,
        durationMinutes,
        locationMode,
        roomId: locationMode === "InPerson" ? selectedRoomId : undefined,
        adminCalendarId: selectedCalendarId,
        sendInvites,
      };
      
      const { data, error } = await supabase.functions.invoke(createFnName, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: requestBody,
      });
      
      const ms = Date.now() - startedAt;
      
      if (controller.signal.aborted) {
        appendLog('warn', `${createFnName}: Aborted after ${ms}ms`);
        return;
      }
      controller.abort();
      
      if (error) {
        appendLog('error', `${createFnName} error after ${ms}ms`, { message: error.message });
        throw { message: error.message, status: error.status || 500, functionName: createFnName };
      }
      
      if (data?.ok === false || !data?.success) {
        appendLog('error', `${createFnName} returned failure after ${ms}ms`, { error: data?.error });
        throw { message: data?.error?.message || data?.error || "Failed to create test booking", status: data?.error?.status };
      }
      
      createdMeetingId = data.meetingId;
      setMeetingId(createdMeetingId);
      
      appendLog('info', `${createFnName} success after ${ms}ms`, { 
        meetingId: createdMeetingId,
        keys: data ? Object.keys(data) : []
      });
      
      updateDebug({
        lastAction: `Created meeting ${createdMeetingId}`,
        debugData: { ...debugInfo.debugData, meetingId: createdMeetingId },
      });
      
    } catch (err: any) {
      if (flowState === "timeout") {
        appendLog('warn', 'Timeout already handled, skipping error');
        return;
      }
      appendLog('error', `${createFnName} threw exception`, { message: err?.message || String(err) });
      setError(createFnName, err, "creating_test_request");
      setCurrentStep("options"); // Go back
      return;
    }
    
    // Step 2: Load available slots
    if (!createdMeetingId) return;
    
    const availFnName = "test-booking-available-slots";
    try {
      appendLog('info', `Flow state -> loading_availability`);
      setFlowState("loading_availability");
      updateDebug({ currentState: "loading_availability", lastAction: "Loading availability", lastFunction: availFnName });
      
      appendLog('info', `Invoking ${availFnName}`, { meetingId: createdMeetingId });
      const startedAt = Date.now();
      const controller = setTimeout_("availability", TIMEOUTS.availability);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        appendLog('error', `${availFnName}: Not authenticated`);
        throw new Error("Not authenticated");
      }
      
      if (controller.signal.aborted) {
        appendLog('warn', `${availFnName}: Aborted before call`);
        return;
      }
      
      const { data, error } = await supabase.functions.invoke(availFnName, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { meetingId: createdMeetingId },
      });
      
      const ms = Date.now() - startedAt;
      
      if (controller.signal.aborted) {
        appendLog('warn', `${availFnName}: Aborted after ${ms}ms`);
        return;
      }
      controller.abort();
      
      if (error) {
        appendLog('error', `${availFnName} error after ${ms}ms`, { message: error.message });
        throw { message: error.message, status: error.status || 500, functionName: availFnName };
      }
      
      if (data?.ok === false) {
        appendLog('error', `${availFnName} returned ok:false after ${ms}ms`, { error: data?.error });
        throw { message: data?.error?.message || "Failed to load availability", status: data?.error?.status };
      }
      
      const slots = data?.slots || data?.data?.slots || [];
      const debug = data?.debug || {};
      
      appendLog('info', `${availFnName} success after ${ms}ms`, { 
        slotsCount: slots.length,
        debug: debug,
        keys: data ? Object.keys(data) : []
      });
      
      // If edge returns debugSteps, append them
      if (data?.debugSteps?.length) {
        for (const step of data.debugSteps) {
          appendLog(step.level || 'info', `[${availFnName}] ${step.message}`, step.details || step);
        }
      }
      
      setAvailableSlots(slots);
      setAvailabilityDebug({
        calendarsUsed: debug.calendarsUsed || [selectedCalendarId],
        freebusyIntervalCount: debug.freebusyIntervalCount ?? "N/A",
        eventsCount: debug.eventsCount ?? "N/A",
        slotsGenerated: slots.length,
        timezoneUsed: debug.timezoneUsed || "N/A",
        ...debug,
      });
      
      appendLog('info', `Flow state -> ready_to_select_slot`);
      setFlowState("ready_to_select_slot");
      updateDebug({
        currentState: "ready_to_select_slot",
        lastAction: `Found ${slots.length} slots`,
        debugData: { ...debugInfo.debugData, slotsCount: slots.length, availabilityDebug: debug },
      });
      
    } catch (err: any) {
      if (flowState === "timeout") {
        appendLog('warn', 'Timeout already handled, skipping error');
        return;
      }
      appendLog('error', `${availFnName} threw exception`, { message: err?.message || String(err) });
      setError(availFnName, err, "loading_availability");
    }
  }, [selectedMeetingTypeId, locationMode, selectedRoomId, rooms, selectedCalendarId, durationMinutes, sendInvites, setTimeout_, setError, updateDebug, debugInfo.debugData, flowState, appendLog]);
  
  // ========== CONFIRM BOOKING ==========
  const handleConfirmBooking = useCallback(async () => {
    if (!selectedSlot || !meetingId) {
      appendLog('warn', 'Missing slot or meeting ID for confirm');
      return;
    }
    
    const confirmFnName = "confirm-test-booking";
    const newRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    appendLog('info', `Flow state -> confirming`, { 
      meetingId, 
      slot: { start: selectedSlot.start, end: selectedSlot.end },
      runId: newRunId
    });
    
    setRunId(newRunId);
    setProgressLogs([]);
    setCurrentStep("processing");
    setFlowState("confirming");
    updateDebug({ currentState: "confirming", lastAction: "Confirming booking", lastFunction: confirmFnName });
    
    pollingStartRef.current = Date.now();
    
    try {
      appendLog('info', `Invoking ${confirmFnName}`);
      const startedAt = Date.now();
      const controller = setTimeout_("confirm_booking", TIMEOUTS.confirm_booking);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        appendLog('error', `${confirmFnName}: Not authenticated`);
        throw new Error("Not authenticated");
      }
      
      if (controller.signal.aborted) {
        appendLog('warn', `${confirmFnName}: Aborted before call`);
        return;
      }
      
      const { data, error } = await supabase.functions.invoke(confirmFnName, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          meetingId,
          startDatetime: selectedSlot.start,
          endDatetime: selectedSlot.end,
          runId: newRunId,
        },
      });
      
      const ms = Date.now() - startedAt;
      
      if (controller.signal.aborted) {
        appendLog('warn', `${confirmFnName}: Aborted after ${ms}ms`);
        return;
      }
      controller.abort();
      
      if (error) {
        appendLog('error', `${confirmFnName} error after ${ms}ms`, { message: error.message });
        throw { message: error.message, status: error.status || 500, functionName: confirmFnName };
      }
      
      if (data?.ok === false || !data?.success) {
        appendLog('error', `${confirmFnName} returned failure after ${ms}ms`, { error: data?.error });
        throw { message: data?.error?.message || data?.error || "Booking failed", status: data?.error?.status };
      }
      
      // Check for partial success (hasErrors or missing IDs)
      const hasWarnings = data?.hasErrors === true || !data?.lawmaticsAppointmentId;
      
      if (hasWarnings) {
        appendLog('warn', `${confirmFnName} completed with warnings after ${ms}ms`, { 
          lawmaticsAppointmentId: data?.lawmaticsAppointmentId,
          googleEventId: data?.googleEventId,
          hasErrors: data?.hasErrors,
          errors: data?.errors,
        });
      } else {
        appendLog('success', `${confirmFnName} success after ${ms}ms`, { 
          lawmaticsAppointmentId: data?.lawmaticsAppointmentId,
          googleEventId: data?.googleEventId,
          keys: data ? Object.keys(data) : []
        });
      }
      
      // If edge returns debugSteps, append them
      if (data?.debugSteps?.length) {
        for (const step of data.debugSteps) {
          appendLog(step.level || 'info', `[${confirmFnName}] ${step.message}`, step.details || step);
        }
      }
      
      // Log individual integration errors
      if (data?.errors?.length) {
        for (const err of data.errors) {
          appendLog('error', `${err.system} failed: ${err.message}`, { 
            status: err.status, 
            responseExcerpt: err.responseExcerpt 
          });
        }
      }
      
      setBookingResult(data);
      appendLog('info', `Flow state -> success`);
      setFlowState("success");
      setCurrentStep("done");
      updateDebug({
        currentState: "success",
        lastAction: hasWarnings ? "Booking completed with warnings" : "Booking confirmed",
        debugData: { ...debugInfo.debugData, bookingResult: data },
      });
      
    } catch (err: any) {
      if (flowState === "timeout") {
        appendLog('warn', 'Timeout already handled, skipping error');
        return;
      }
      appendLog('error', `${confirmFnName} threw exception`, { message: err?.message || String(err) });
      setError(confirmFnName, err, "confirming");
    }
  }, [selectedSlot, meetingId, setTimeout_, setError, updateDebug, debugInfo.debugData, flowState, appendLog]);
  
  // ========== POLLING FOR LOGS ==========
  useEffect(() => {
    if (!meetingId || !runId || currentStep !== "processing") return;
    
    let isMounted = true;
    pollingStartRef.current = Date.now();
    
    const fetchLogs = async () => {
      if (!isMounted) return;
      
      // Check polling timeout
      if (Date.now() - pollingStartRef.current > TIMEOUTS.polling_max) {
        setFlowState("timeout");
        updateDebug({
          currentState: "timeout",
          lastAction: "Polling timed out",
          lastError: {
            functionName: "polling",
            message: `Polling timed out after ${TIMEOUTS.polling_max / 1000}s`,
            step: "processing",
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      
      try {
        const { data } = await supabase
          .from("booking_progress_logs")
          .select("*")
          .eq("meeting_id", meetingId)
          .eq("run_id", runId)
          .order("created_at", { ascending: true });
        
        if (!isMounted) return;
        
        if (data) {
          setProgressLogs(data);
          const doneLog = data.find((l) => l.step === "done");
          if (doneLog) {
            setFlowState("success");
            setCurrentStep("done");
            updateDebug({ currentState: "success", lastAction: "Processing complete" });
            return;
          }
          
          const errorLog = data.find((l) => l.level === "error");
          if (errorLog) {
            setFlowState("error");
            updateDebug({
              currentState: "error",
              lastError: {
                functionName: "confirm-test-booking",
                message: errorLog.message,
                step: errorLog.step,
                timestamp: errorLog.created_at,
              },
            });
            return;
          }
        }
        
        // Continue polling
        pollingTimeoutRef.current = setTimeout(fetchLogs, 800);
      } catch (err) {
        console.error("Error fetching logs:", err);
        pollingTimeoutRef.current = setTimeout(fetchLogs, 800);
      }
    };
    
    fetchLogs();
    
    return () => {
      isMounted = false;
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, [meetingId, runId, currentStep, updateDebug]);
  
  // ========== CLEANUP ON CLOSE ==========
  useEffect(() => {
    if (!open) {
      clearAllTimeouts();
    }
  }, [open, clearAllTimeouts]);
  
  const handleNextFromCalendar = () => {
    if (!selectedCalendarId) {
      toast.error("Please select a calendar");
      return;
    }
    appendLog('info', `Calendar selected: ${selectedCalendarId}`);
    setCurrentStep("options");
  };
  
  const handleSelectSlot = (slot: TimeSlot) => {
    appendLog('info', `Slot selected`, { start: slot.start, end: slot.end });
    setSelectedSlot(slot);
    setCurrentStep("confirm");
  };
  
  const handleClose = () => {
    handleReset();
    onOpenChange(false);
  };
  
  const selectedMeetingType = meetingTypes?.find((mt) => mt.id === selectedMeetingTypeId);
  const selectedRoom = rooms?.find((r) => r.id === selectedRoomId);
  const selectedCalendar = calendars.find((c) => c.id === selectedCalendarId);
  
  const isLoading = flowState === "loading_calendars" || flowState === "creating_test_request" || flowState === "loading_availability" || flowState === "confirming";
  const hasError = flowState === "error" || flowState === "timeout";
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <TestTube className="h-5 w-5" />
              Test My Booking
              <Badge variant="secondary" className="ml-2">Admin Only</Badge>
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleCopyDebugReport} title="Copy Debug Report">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowDebugPanel(!showDebugPanel)} title="Toggle Debug Panel">
                <Bug className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-1" /> Reset
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        {/* Debug Panel - Always visible when enabled */}
        {showDebugPanel && (
          <Card className="border-dashed border-muted-foreground/30 bg-muted/30">
            <CardContent className="py-3 px-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div><span className="text-muted-foreground">State:</span> <Badge variant={hasError ? "destructive" : isLoading ? "secondary" : "outline"} className="text-xs">{flowState}</Badge></div>
                <div><span className="text-muted-foreground">Step:</span> {currentStep}</div>
                <div><span className="text-muted-foreground">Last action:</span> {debugInfo.lastAction}</div>
                <div><span className="text-muted-foreground">Last function:</span> {debugInfo.lastFunction}</div>
              </div>
              {debugInfo.lastError && (
                <div className="mt-2 p-2 bg-destructive/10 rounded text-destructive">
                  <div><strong>Error:</strong> {debugInfo.lastError.message}</div>
                  {debugInfo.lastError.statusCode && <div>Status: {debugInfo.lastError.statusCode}</div>}
                  {debugInfo.lastError.responseExcerpt && debugInfo.lastError.responseExcerpt !== debugInfo.lastError.message && (
                    <div className="truncate">Response: {debugInfo.lastError.responseExcerpt}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
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
          {/* Error/Timeout State Overlay */}
          {hasError && (
            <Card className="border-destructive bg-destructive/5 mb-4">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-destructive">
                      {flowState === "timeout" ? "Operation Timed Out" : "Error Occurred"}
                    </h4>
                    {debugInfo.lastError && (
                      <div className="text-sm mt-1 space-y-1">
                        <p><strong>Function:</strong> {debugInfo.lastError.functionName}</p>
                        <p><strong>Message:</strong> {debugInfo.lastError.message}</p>
                        {debugInfo.lastError.statusCode && <p><strong>Status:</strong> {debugInfo.lastError.statusCode}</p>}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" onClick={handleReset}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Reset & Retry
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleCopyDebugReport}>
                        <Copy className="h-4 w-4 mr-1" /> Copy Debug Report
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Step 1: Calendar Selection */}
          {currentStep === "calendar" && !hasError && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Select which of your connected Google calendars to use for availability checking and event creation.
              </p>
              
              {flowState === "loading_calendars" ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading calendars...</span>
                </div>
              ) : calendars.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p>No Google calendars connected.</p>
                    <p className="text-sm text-muted-foreground">Please connect your Google Calendar in Settings first.</p>
                    <Button variant="outline" className="mt-4" onClick={loadCalendars}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Retry
                    </Button>
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
                <Button onClick={handleNextFromCalendar} disabled={!selectedCalendarId || isLoading}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 2: Options */}
          {currentStep === "options" && !hasError && (
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
                <Button onClick={handleNextFromOptions} disabled={!selectedMeetingTypeId || isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 3: Availability */}
          {currentStep === "availability" && !hasError && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Select an available time slot. Availability is based on your selected calendar: <strong>{selectedCalendar?.summary}</strong>
              </p>
              
              {/* Availability Debug Summary */}
              {Object.keys(availabilityDebug).length > 0 && (
                <Card className="bg-muted/30">
                  <CardContent className="py-2 px-4 text-xs font-mono">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <div>Calendars: {JSON.stringify(availabilityDebug.calendarsUsed)}</div>
                      <div>Freebusy intervals: {availabilityDebug.freebusyIntervalCount}</div>
                      <div>Events: {availabilityDebug.eventsCount}</div>
                      <div>Slots generated: {availabilityDebug.slotsGenerated}</div>
                      <div className="col-span-2">Timezone: {availabilityDebug.timezoneUsed}</div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {(flowState === "creating_test_request" || flowState === "loading_availability") ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="mt-2 text-sm text-muted-foreground">
                    {flowState === "creating_test_request" ? "Creating test booking..." : "Loading availability..."}
                  </span>
                </div>
              ) : availableSlots.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center">
                    <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p>No available slots found.</p>
                    <p className="text-sm text-muted-foreground">Your calendar may be fully booked, or no business hours are available.</p>
                    {/* Show debug info even when empty */}
                    <div className="mt-4 text-xs text-left bg-muted/50 p-3 rounded font-mono">
                      <div>Slots generated: 0</div>
                      <div>Calendars checked: {availabilityDebug.calendarsUsed?.join(", ") || selectedCalendarId}</div>
                    </div>
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
          {currentStep === "confirm" && selectedSlot && !hasError && (
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
                <Button onClick={handleConfirmBooking} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Confirm Test Booking
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 5: Processing */}
          {currentStep === "processing" && !hasError && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing test booking...
              </div>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Execution Log ({clientLogs.length} entries)
                    </span>
                    <Button variant="ghost" size="sm" onClick={handleCopyLogs}>
                      <Copy className="h-3 w-3 mr-1" /> Copy Logs
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[250px]">
                    <div className="space-y-2 pr-4 font-mono text-xs">
                      {clientLogs.length === 0 ? (
                        <p className="text-muted-foreground">No logs yet</p>
                      ) : (
                        clientLogs.map((log, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            {getLogIcon(log.level)}
                            <span className="text-muted-foreground shrink-0">
                              {format(new Date(log.ts), "HH:mm:ss")}
                            </span>
                            <span className={log.level === "error" ? "text-destructive" : log.level === "success" ? "text-green-500" : log.level === "warn" ? "text-yellow-600" : ""}>
                              {log.message}
                            </span>
                          </div>
                        ))
                      )}
                      <div ref={logsEndRef} />
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
              
              <div className="flex justify-end pt-4">
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Cancel & Reset
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 6: Done */}
          {currentStep === "done" && (
            <DoneStep
              bookingResult={bookingResult}
              clientLogs={clientLogs}
              logsEndRef={logsEndRef}
              handleCopyLogs={handleCopyLogs}
              handleReset={handleReset}
              handleClose={handleClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========== DONE STEP COMPONENT ==========
interface DoneStepProps {
  bookingResult: any;
  clientLogs: LogEntry[];
  logsEndRef: React.RefObject<HTMLDivElement>;
  handleCopyLogs: () => Promise<void>;
  handleReset: () => void;
  handleClose: () => void;
}

function DoneStep({ 
  bookingResult, 
  clientLogs, 
  logsEndRef, 
  handleCopyLogs, 
  handleReset, 
  handleClose 
}: DoneStepProps) {
  const [debugOpen, setDebugOpen] = useState(false);
  
  // Compute effective status for Lawmatics (UI-only logic)
  const lawmaticsStatus = useMemo(() => getEffectiveLawmaticsStatus(bookingResult), [bookingResult]);
  const googleCreated = !!bookingResult?.googleEventId;
  
  // Determine overall banner status
  const overallSuccess = googleCreated && lawmaticsStatus.tone === "success";
  const overallWarning = lawmaticsStatus.tone === "warning" || (!googleCreated && lawmaticsStatus.tone === "success");
  const overallError = !googleCreated && lawmaticsStatus.tone === "error";

  // Get log display class - downgrade "warn" to "info" if effective status is success
  const getLogDisplayClass = (log: LogEntry) => {
    // If the log is "completed with warnings" but effective status is success, show as neutral
    if (log.level === "warn" && log.message.includes("completed with warnings") && lawmaticsStatus.tone === "success") {
      return ""; // neutral/info color
    }
    if (log.level === "error") return "text-destructive";
    if (log.level === "success") return "text-green-500";
    if (log.level === "warn") return "text-yellow-600";
    return "";
  };

  return (
    <div className="space-y-4 py-4">
      {/* Main Banner - based on effective status */}
      <div className="text-center py-4">
        {overallError ? (
          <>
            <XCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Test Booking Failed</h3>
            <p className="text-sm text-muted-foreground mt-1">
              One or more integrations failed. See details below.
            </p>
          </>
        ) : overallWarning ? (
          <>
            <AlertCircle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
            <h3 className="text-lg font-semibold">Test Booking Completed with Warnings</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {!googleCreated ? "Google Calendar failed. " : ""}
              {lawmaticsStatus.tone === "warning" ? lawmaticsStatus.subtitle : ""}
            </p>
          </>
        ) : (
          <>
            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h3 className="text-lg font-semibold">Test Booking Complete!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Google Calendar created. Lawmatics appointment created.
            </p>
          </>
        )}
      </div>
      
      {/* Integration Results Card */}
      {bookingResult && (
        <Card className={overallError ? "border-destructive" : overallWarning ? "border-yellow-500" : "border-green-500"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Integration Results</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            {/* Google Calendar Status */}
            <div className="flex items-center gap-2">
              {googleCreated ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Google Calendar:</span>
                  <span className="text-green-600">Created</span>
                  <span className="text-muted-foreground text-xs">({bookingResult.googleEventId})</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="font-medium">Google Calendar:</span>
                  <span className="text-destructive">Failed</span>
                </>
              )}
            </div>

            {/* Lawmatics Status - using effective status */}
            <div className="flex items-center gap-2">
              {lawmaticsStatus.tone === "success" ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Lawmatics:</span>
                  <span className="text-green-600">{lawmaticsStatus.label}</span>
                  {bookingResult.lawmaticsAppointmentId && (
                    <span className="text-muted-foreground text-xs">({bookingResult.lawmaticsAppointmentId})</span>
                  )}
                </>
              ) : lawmaticsStatus.tone === "warning" ? (
                <>
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span className="font-medium">Lawmatics:</span>
                  <span className="text-yellow-600">{lawmaticsStatus.label}</span>
                  {bookingResult.lawmaticsAppointmentId && (
                    <span className="text-muted-foreground text-xs">({bookingResult.lawmaticsAppointmentId})</span>
                  )}
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="font-medium">Lawmatics:</span>
                  <span className="text-destructive">{lawmaticsStatus.label}</span>
                </>
              )}
            </div>
            
            {/* Subtitle for warnings */}
            {lawmaticsStatus.tone === "warning" && (
              <p className="text-xs text-yellow-600 ml-6">{lawmaticsStatus.subtitle}</p>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Collapsible Debug Details */}
      <Collapsible open={debugOpen} onOpenChange={setDebugOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Bug className="h-4 w-4" />
                  Details (debug)
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${debugOpen ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="text-sm space-y-4 pt-0">
              {/* hasErrors flag */}
              {bookingResult && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">hasErrors:</span>
                  <Badge variant={bookingResult.hasErrors ? "destructive" : "secondary"}>
                    {String(bookingResult.hasErrors)}
                  </Badge>
                </div>
              )}
              
              {/* Error Details */}
              {bookingResult?.errors?.length > 0 && (
                <div className="p-3 bg-destructive/10 rounded-lg space-y-2">
                  <p className="font-medium text-destructive text-xs">Raw Errors ({bookingResult.errors.length}):</p>
                  {bookingResult.errors.map((err: any, idx: number) => (
                    <div key={idx} className="text-xs space-y-1">
                      <p><strong>{err.system}:</strong> {err.message}</p>
                      {err.status && <p className="text-muted-foreground">Status: {err.status}</p>}
                      {err.responseExcerpt && (
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-20">
                          {err.responseExcerpt}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Attempted Variants */}
              {bookingResult?.lawmatics?.attemptedVariants?.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-xs">Attempted Variants ({bookingResult.lawmatics.attemptedVariants.length}):</p>
                  <div className="p-2 bg-muted rounded text-xs font-mono">
                    {bookingResult.lawmatics.attemptedVariants.map((v: string, i: number) => (
                      <div key={i} className={v === bookingResult.lawmatics?.winningVariant ? "text-green-600 font-medium" : ""}>
                        {v}{v === bookingResult.lawmatics?.winningVariant ? " ✓" : ""}
                      </div>
                    ))}
                  </div>
                  {bookingResult.lawmatics?.winningVariant && (
                    <p className="text-xs text-muted-foreground">Winning variant: <span className="text-green-600 font-medium">{bookingResult.lawmatics.winningVariant}</span></p>
                  )}
                </div>
              )}

              {/* Lawmatics Readback */}
              {(bookingResult?.lawmaticsReadback || bookingResult?.lawmatics?.readback) && (
                <div className="space-y-2">
                  <p className="font-medium text-xs">Lawmatics Readback:</p>
                  <div className="p-3 bg-muted rounded-lg">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
{JSON.stringify(bookingResult.lawmaticsReadback || bookingResult.lawmatics?.readback, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Payload Computed */}
              {bookingResult?.lawmatics?.payloadComputed && (
                <div className="space-y-2">
                  <p className="font-medium text-xs">Payload Computed:</p>
                  <div className="p-3 bg-muted rounded-lg">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
{JSON.stringify(bookingResult.lawmatics.payloadComputed, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Copy Debug JSON Button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={async () => {
                  const debugData = {
                    hasErrors: bookingResult?.hasErrors,
                    errors: bookingResult?.errors,
                    lawmaticsReadback: bookingResult?.lawmaticsReadback || bookingResult?.lawmatics?.readback,
                    attemptedVariants: bookingResult?.lawmatics?.attemptedVariants,
                    winningVariant: bookingResult?.lawmatics?.winningVariant,
                    payloadComputed: bookingResult?.lawmatics?.payloadComputed,
                    googleEventId: bookingResult?.googleEventId,
                    lawmaticsAppointmentId: bookingResult?.lawmaticsAppointmentId,
                  };
                  const success = await copyToClipboard(JSON.stringify(debugData, null, 2));
                  if (success) toast.success("Debug JSON copied to clipboard");
                }}
              >
                <Copy className="h-3 w-3 mr-1" /> Copy Debug JSON
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
      
      {/* Execution Log - collapsed by default, uses adjusted colors */}
      <Collapsible>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Execution Log ({clientLogs.length} entries)
                </span>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={(e) => { e.stopPropagation(); handleCopyLogs(); }}
                  >
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                  <ChevronDown className="h-4 w-4" />
                </div>
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <ScrollArea className="h-[200px]">
                <div className="space-y-2 pr-4 font-mono text-xs">
                  {clientLogs.length === 0 ? (
                    <p className="text-muted-foreground">No logs recorded</p>
                  ) : (
                    clientLogs.map((log, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        {getLogIcon(log.level)}
                        <span className="text-muted-foreground shrink-0">
                          {format(new Date(log.ts), "HH:mm:ss")}
                        </span>
                        <span className={getLogDisplayClass(log)}>
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
      
      <div className="flex justify-end pt-4 gap-2">
        <Button variant="outline" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-1" /> Test Again
        </Button>
        <Button onClick={handleClose}>Close</Button>
      </div>
    </div>
  );
}
