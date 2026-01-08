import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { 
  Calendar, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Eye, 
  Link2, 
  AlertCircle, 
  Search, 
  Unlink,
  ExternalLink,
  MapPin,
  Clock,
  ChevronLeft,
  ChevronRight,
  CalendarCheck,
  Bug
} from "lucide-react";
import { formatDistanceToNow, format, parseISO, isToday, isTomorrow, startOfDay } from "date-fns";

interface CalendarConnection {
  id: string;
  user_id: string;
  provider: string;
  token_expires_at: string | null;
  last_verified_at: string | null;
  last_verified_ok: boolean | null;
  last_verified_error: string | null;
  last_calendar_list_count: number | null;
  created_at: string;
  users: {
    id: string;
    name: string;
    email: string;
  } | null;
}

interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
  selected: boolean;
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  htmlLink: string;
  status: string;
}

interface DaySummary {
  date: string;
  slotCount: number;
  firstSlotStart?: string;
  lastSlotStart?: string;
}

interface DaySlot {
  start: string;
  end: string;
  label: string;
}

export function GoogleCalendarConnections() {
  const { isAdmin, internalUser } = useAuth();
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const [viewingCalendars, setViewingCalendars] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [calendarSearch, setCalendarSearch] = useState("");
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [verifyingUserId, setVerifyingUserId] = useState<string | null>(null);
  
  // Events state
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("primary");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Availability state
  const [availabilityMonth, setAvailabilityMonth] = useState<number>(new Date().getMonth() + 1);
  const [availabilityYear, setAvailabilityYear] = useState<number>(new Date().getFullYear());
  const [availabilityDuration, setAvailabilityDuration] = useState<number>(60);
  const [availabilityDays, setAvailabilityDays] = useState<DaySummary[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState<string | null>(null);
  const [daySlots, setDaySlots] = useState<DaySlot[]>([]);
  const [isLoadingDaySlots, setIsLoadingDaySlots] = useState(false);
  const [daySlotsError, setDaySlotsError] = useState<string | null>(null);
  const [activeDialogTab, setActiveDialogTab] = useState<string>("calendars");

  // Debug busy state
  const [isDebugging, setIsDebugging] = useState(false);
  const [debugOverlapEnabled, setDebugOverlapEnabled] = useState(false);
  const [debugResult, setDebugResult] = useState<{
    freebusyCount: number;
    eventsCount: number;
    calendarsChecked: string[];
    busySource: string;
    debug?: {
      dayStartIso: string;
      dayEndIso: string;
      rawBusyCount: number;
      mergedBusyCount: number;
      first3Busy: { start: string; end: string }[];
      candidateSlots: { start: string; end: string; label: string }[];
      filteredSlots: { start: string; end: string; label: string }[];
    };
  } | null>(null);

  // Fetch all calendar connections (admin sees all, staff sees own)
  const { data: connections, isLoading: loadingConnections } = useQuery({
    queryKey: ["google-calendar-connections", isAdmin],
    queryFn: async () => {
      let query = supabase
        .from("calendar_connections")
        .select(`
          id,
          user_id,
          provider,
          token_expires_at,
          last_verified_at,
          last_verified_ok,
          last_verified_error,
          last_calendar_list_count,
          created_at,
          users:user_id (id, name, email)
        `)
        .eq("provider", "google")
        .order("created_at", { ascending: false });

      if (!isAdmin && internalUser?.id) {
        query = query.eq("user_id", internalUser.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as CalendarConnection[];
    },
  });

  // Verify connection mutation
  const verifyMutation = useMutation({
    mutationFn: async (internalUserId: string) => {
      setVerifyingUserId(internalUserId);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-connection-status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { internalUserId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-connections", isAdmin] });
      if (data.verified_ok) {
        toast.success("Google Calendar verified successfully");
      } else {
        toast.error(`Verification failed: ${data.error || "Unknown error"}`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to verify: ${error.message}`);
    },
    onSettled: () => {
      setVerifyingUserId(null);
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (internalUserId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-disconnect", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { internalUserId },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Disconnect failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-connections"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-connection-status"] });
      toast.success("Google Calendar disconnected.");
      if (data.revoke_error) {
        console.warn("Token revoke warning:", data.revoke_error);
      }
    },
    onError: (error) => {
      toast.error(`Failed to disconnect: ${error.message}`);
    },
  });

  // Fetch events for selected calendar
  const fetchEvents = async (internalUserId: string, calendarId: string) => {
    setIsLoadingEvents(true);
    setEventsError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-list-events", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { internalUserId, calendarId },
      });

      if (error) throw error;

      if (data.error) {
        setEventsError(data.error);
        setEvents([]);
      } else {
        setEvents(data.events || []);
      }
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Failed to load events");
      setEvents([]);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  // Fetch month availability
  const fetchMonthAvailability = async (internalUserId: string, month: number, year: number, duration: number) => {
    setIsLoadingAvailability(true);
    setAvailabilityError(null);
    setSelectedAvailabilityDate(null);
    setDaySlots([]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Compute calendar IDs to check from the loaded calendars (primary + selected)
      const calendarIdsToCheck = calendars
        .filter(c => c.primary || c.selected)
        .map(c => c.id);

      const { data, error } = await supabase.functions.invoke("google-availability-month", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { 
          internalUserId, 
          month, 
          year, 
          durationMinutes: duration,
          calendarIds: calendarIdsToCheck.length > 0 ? calendarIdsToCheck : undefined 
        },
      });

      if (error) throw error;

      if (data.error) {
        setAvailabilityError(data.error);
        setAvailabilityDays([]);
      } else {
        setAvailabilityDays(data.days || []);
      }
    } catch (err) {
      setAvailabilityError(err instanceof Error ? err.message : "Failed to load availability");
      setAvailabilityDays([]);
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  // Fetch day slots
  const fetchDaySlots = async (internalUserId: string, date: string, duration: number) => {
    setIsLoadingDaySlots(true);
    setDaySlotsError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Compute calendar IDs to check from the loaded calendars (primary + selected)
      const calendarIdsToCheck = calendars
        .filter(c => c.primary || c.selected)
        .map(c => c.id);

      const { data, error } = await supabase.functions.invoke("google-availability-day", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { 
          internalUserId, 
          date, 
          durationMinutes: duration,
          calendarIds: calendarIdsToCheck.length > 0 ? calendarIdsToCheck : undefined 
        },
      });

      if (error) throw error;

      if (data.error) {
        setDaySlotsError(data.error);
        setDaySlots([]);
      } else {
        setDaySlots(data.slots || []);
      }
    } catch (err) {
      setDaySlotsError(err instanceof Error ? err.message : "Failed to load slots");
      setDaySlots([]);
    } finally {
      setIsLoadingDaySlots(false);
    }
  };

  // View calendars and events
  const handleViewCalendars = async (internalUserId: string) => {
    setViewingCalendars(internalUserId);
    setIsLoadingCalendars(true);
    setCalendarError(null);
    setCalendars([]);
    setCalendarSearch("");
    setEvents([]);
    setEventsError(null);
    setSelectedCalendarId("primary");
  setActiveDialogTab("calendars");
    setAvailabilityDays([]);
    setSelectedAvailabilityDate(null);
    setDaySlots([]);
    setDebugResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-list-calendars", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { internalUserId },
      });

      if (error) throw error;

      if (data.error) {
        setCalendarError(data.error);
      } else {
        const calendarList = data.calendars || [];
        setCalendars(calendarList);
        queryClient.invalidateQueries({ queryKey: ["google-calendar-connections"] });

        // Auto-select primary calendar or first one
        const primaryCal = calendarList.find((c: CalendarInfo) => c.primary);
        const defaultCalId = primaryCal?.id || calendarList[0]?.id || "primary";
        setSelectedCalendarId(defaultCalId);

        // Fetch events for the selected calendar
        if (calendarList.length > 0) {
          await fetchEvents(internalUserId, defaultCalId);
        }
      }
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Failed to load calendars");
    } finally {
      setIsLoadingCalendars(false);
    }
  };

  // Handle calendar selection change
  const handleCalendarSelect = async (calendarId: string) => {
    setSelectedCalendarId(calendarId);
    if (viewingCalendars) {
      await fetchEvents(viewingCalendars, calendarId);
    }
  };

  // Handle tab change
  const handleTabChange = (tab: string) => {
    setActiveDialogTab(tab);
    if (tab === "availability" && viewingCalendars && availabilityDays.length === 0) {
      fetchMonthAvailability(viewingCalendars, availabilityMonth, availabilityYear, availabilityDuration);
    }
  };

  // Handle month navigation
  const handlePreviousMonth = () => {
    let newMonth = availabilityMonth - 1;
    let newYear = availabilityYear;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    setAvailabilityMonth(newMonth);
    setAvailabilityYear(newYear);
    if (viewingCalendars) {
      fetchMonthAvailability(viewingCalendars, newMonth, newYear, availabilityDuration);
    }
  };

  const handleNextMonth = () => {
    let newMonth = availabilityMonth + 1;
    let newYear = availabilityYear;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    setAvailabilityMonth(newMonth);
    setAvailabilityYear(newYear);
    if (viewingCalendars) {
      fetchMonthAvailability(viewingCalendars, newMonth, newYear, availabilityDuration);
    }
  };

  // Handle duration change
  const handleDurationChange = (value: string) => {
    const duration = parseInt(value, 10);
    setAvailabilityDuration(duration);
    if (viewingCalendars) {
      fetchMonthAvailability(viewingCalendars, availabilityMonth, availabilityYear, duration);
    }
  };

  // Handle day click
  const handleDayClick = (date: string) => {
    setSelectedAvailabilityDate(date);
    setDebugResult(null);
    if (viewingCalendars) {
      fetchDaySlots(viewingCalendars, date, availabilityDuration);
    }
  };

  // Debug busy - compare FreeBusy vs Events API
  const handleDebugBusy = async () => {
    if (!viewingCalendars || !selectedAvailabilityDate) return;
    
    setIsDebugging(true);
    setDebugResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const calendarIdsToCheck = calendars
        .filter(c => c.primary || c.selected)
        .map(c => c.id);

      // Call google-busy-debug to get FreeBusy count
      const { data: freebusyData, error: freebusyError } = await supabase.functions.invoke("google-busy-debug", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { 
          internalUserId: viewingCalendars,
          start: `${selectedAvailabilityDate}T00:00:00Z`,
          end: `${selectedAvailabilityDate}T23:59:59Z`,
        },
      });

      if (freebusyError) {
        console.error("FreeBusy debug error:", freebusyError);
      }

      // Get a fresh day slots call to see what we're using - with debug flag
      const { data: dayData } = await supabase.functions.invoke("google-availability-day", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { 
          internalUserId: viewingCalendars, 
          date: selectedAvailabilityDate, 
          durationMinutes: availabilityDuration,
          calendarIds: calendarIdsToCheck.length > 0 ? calendarIdsToCheck : undefined,
          debug: debugOverlapEnabled
        },
      });

      setDebugResult({
        freebusyCount: freebusyData?.busyIntervals?.length || 0,
        eventsCount: dayData?.eventsCount || dayData?.busyIntervalsCount || 0,
        calendarsChecked: dayData?.calendarsChecked || freebusyData?.calendarsChecked || [],
        busySource: dayData?.busySource || "freebusy",
        debug: dayData?.debug,
      });

      toast.success("Debug info loaded");
    } catch (err) {
      toast.error("Failed to load debug info");
      console.error("Debug error:", err);
    } finally {
      setIsDebugging(false);
    }
  };

  // Connect Google Calendar
  const connectMutation = useMutation({
    mutationFn: async () => {
      setIsConnecting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("google-oauth-start", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (!data?.authUrl) throw new Error("No authorization URL returned");

      window.location.href = data.authUrl;
    },
    onError: (error) => {
      setIsConnecting(false);
      toast.error(`Failed to start Google connection: ${error.message}`);
    },
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  const filteredCalendars = calendars.filter(
    (cal) =>
      cal.summary.toLowerCase().includes(calendarSearch.toLowerCase()) ||
      cal.id.toLowerCase().includes(calendarSearch.toLowerCase())
  );

  // Group events by date
  const groupEventsByDate = (events: CalendarEvent[]) => {
    const groups: { [key: string]: CalendarEvent[] } = {};
    
    events.forEach((event) => {
      const dateStr = event.start.dateTime || event.start.date || "";
      const date = dateStr ? startOfDay(parseISO(dateStr)).toISOString() : "unknown";
      if (!groups[date]) groups[date] = [];
      groups[date].push(event);
    });

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const formatEventTime = (event: CalendarEvent) => {
    const startStr = event.start.dateTime || event.start.date;
    const endStr = event.end.dateTime || event.end.date;
    
    if (!startStr) return "";

    // All-day event
    if (event.start.date && !event.start.dateTime) {
      return "All day";
    }

    const start = parseISO(startStr);
    const end = endStr ? parseISO(endStr) : null;
    
    if (end) {
      return `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
    }
    return format(start, "h:mm a");
  };

  const formatDateHeader = (dateStr: string) => {
    if (dateStr === "unknown") return "Unknown date";
    const date = parseISO(dateStr);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "EEEE, MMMM d");
  };

  const openGoogleCalendar = (calendarId: string) => {
    const url = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`;
    window.open(url, "_blank");
  };

  const groupedEvents = groupEventsByDate(events);

  // Build month grid
  const buildMonthGrid = () => {
    const firstDay = new Date(availabilityYear, availabilityMonth - 1, 1);
    const lastDay = new Date(availabilityYear, availabilityMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const weeks: (DaySummary | null)[][] = [];
    let currentWeek: (DaySummary | null)[] = [];

    // Add empty cells for days before the first of the month
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${availabilityYear}-${String(availabilityMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const daySummary = availabilityDays.find((d) => d.date === dateStr) || { date: dateStr, slotCount: 0 };
      currentWeek.push(daySummary);

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Fill remaining cells
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    return weeks;
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const monthGrid = buildMonthGrid();

  return (
    <>
      <Card id="calendar">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Google Calendar Connections
          </CardTitle>
          <CardDescription>
            Manage Google Calendar integrations for checking availability
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingConnections ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading connections...
            </div>
          ) : connections && connections.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Verified</TableHead>
                    <TableHead>Calendars</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((conn) => (
                    <TableRow key={conn.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{conn.users?.name || "Unknown"}</div>
                          <div className="text-sm text-muted-foreground">{conn.users?.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {conn.last_verified_ok === null ? (
                          <Badge variant="secondary">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Not Verified
                          </Badge>
                        ) : conn.last_verified_ok ? (
                          <Badge className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {formatDate(conn.last_verified_at)}
                          {conn.last_verified_error && (
                            <div className="text-xs text-destructive mt-0.5 max-w-[200px] truncate" title={conn.last_verified_error}>
                              {conn.last_verified_error}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {conn.last_calendar_list_count !== null ? (
                          <span className="text-sm">{conn.last_calendar_list_count}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => verifyMutation.mutate(conn.user_id)}
                          disabled={verifyingUserId === conn.user_id}
                        >
                          {verifyingUserId === conn.user_id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          <span className="ml-1 hidden sm:inline">Verify</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewCalendars(conn.user_id)}
                        >
                          <Eye className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">View</span>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={disconnectMutation.isPending}
                            >
                              {disconnectMutation.isPending ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <Unlink className="h-4 w-4" />
                              )}
                              <span className="ml-1 hidden sm:inline">Disconnect</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove the calendar connection from LawScheduler for {conn.users?.name || "this user"}. You can reconnect at any time.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => disconnectMutation.mutate(conn.user_id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Disconnect
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No Google Calendar connections found.</p>
              <p className="text-sm">Connect your Google Calendar to check availability.</p>
            </div>
          )}

          <Button
            onClick={() => connectMutation.mutate()}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                Connect My Google Calendar
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* View Calendars & Events Dialog */}
      <Dialog open={viewingCalendars !== null} onOpenChange={(open) => !open && setViewingCalendars(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Google Calendar</DialogTitle>
            <DialogDescription>
              View calendars, events, and availability
            </DialogDescription>
          </DialogHeader>

          {isLoadingCalendars ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Loading calendars...
            </div>
          ) : calendarError ? (
            <div className="text-center py-8">
              <XCircle className="h-12 w-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-destructive">{calendarError}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => viewingCalendars && handleViewCalendars(viewingCalendars)}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          ) : calendars.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No calendars found in this account.</p>
            </div>
          ) : (
            <Tabs value={activeDialogTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="calendars" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Calendars & Events
                </TabsTrigger>
                <TabsTrigger value="availability" className="flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4" />
                  Availability
                </TabsTrigger>
              </TabsList>

              <TabsContent value="calendars" className="flex-1 flex min-h-0 mt-4">
                <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
                  {/* Left: Calendars list */}
                  <div className="w-1/3 flex flex-col min-h-0">
                    <div className="mb-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search calendars..."
                          value={calendarSearch}
                          onChange={(e) => setCalendarSearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                    </div>

                    <ScrollArea className="flex-1">
                      <div className="space-y-1 pr-2">
                        {filteredCalendars.map((cal) => (
                          <div
                            key={cal.id}
                            className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                              selectedCalendarId === cal.id 
                                ? "bg-primary/10 border-primary" 
                                : "bg-card hover:bg-muted"
                            }`}
                            onClick={() => handleCalendarSelect(cal.id)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm truncate">{cal.summary}</div>
                                <div className="text-xs text-muted-foreground truncate">{cal.timeZone}</div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {cal.primary && (
                                  <Badge variant="default" className="text-xs">Primary</Badge>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openGoogleCalendar(cal.id);
                                  }}
                                  title="Open in Google Calendar"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Right: Events list */}
                  <div className="w-2/3 flex flex-col min-h-0 border-l pl-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-sm">Upcoming Events (14 days)</h3>
                      {isLoadingEvents && (
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>

                    {eventsError ? (
                      <div className="text-center py-6">
                        <XCircle className="h-8 w-8 mx-auto mb-2 text-destructive opacity-50" />
                        <p className="text-sm text-destructive">{eventsError}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => viewingCalendars && fetchEvents(viewingCalendars, selectedCalendarId)}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Retry
                        </Button>
                      </div>
                    ) : isLoadingEvents ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                        Loading events...
                      </div>
                    ) : events.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No events in the next 14 days.</p>
                      </div>
                    ) : (
                      <ScrollArea className="flex-1">
                        <div className="space-y-4 pr-2">
                          {groupedEvents.map(([dateKey, dateEvents]) => (
                            <div key={dateKey}>
                              <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                                {formatDateHeader(dateKey)}
                              </h4>
                              <div className="space-y-2">
                                {dateEvents.map((event) => (
                                  <div
                                    key={event.id}
                                    className="p-2 rounded border bg-card text-sm"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="font-medium truncate">{event.summary}</div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                          <Clock className="h-3 w-3" />
                                          <span>{formatEventTime(event)}</span>
                                        </div>
                                        {event.location && (
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                            <MapPin className="h-3 w-3" />
                                            <span className="truncate">{event.location}</span>
                                          </div>
                                        )}
                                      </div>
                                      {event.htmlLink && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 shrink-0"
                                          onClick={() => window.open(event.htmlLink, "_blank")}
                                          title="Open event"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="availability" className="flex-1 flex min-h-0 mt-4">
                <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
                  {/* Left: Month grid */}
                  <div className="w-2/3 flex flex-col min-h-0">
                    {/* Controls */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={handlePreviousMonth}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <h3 className="font-medium text-sm min-w-[140px] text-center">
                          {monthNames[availabilityMonth - 1]} {availabilityYear}
                        </h3>
                        <Button variant="outline" size="icon" onClick={handleNextMonth}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Duration:</span>
                        <Select value={String(availabilityDuration)} onValueChange={handleDurationChange}>
                          <SelectTrigger className="w-[100px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30">30 min</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                            <SelectItem value="90">1.5 hours</SelectItem>
                            <SelectItem value="120">2 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {availabilityError ? (
                      <div className="text-center py-6">
                        <XCircle className="h-8 w-8 mx-auto mb-2 text-destructive opacity-50" />
                        <p className="text-sm text-destructive">{availabilityError}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => viewingCalendars && fetchMonthAvailability(viewingCalendars, availabilityMonth, availabilityYear, availabilityDuration)}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Retry
                        </Button>
                      </div>
                    ) : isLoadingAvailability ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                        Loading availability...
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        {/* Header */}
                        <div className="grid grid-cols-7 bg-muted">
                          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                            <div key={day} className="p-2 text-center text-xs font-medium text-muted-foreground">
                              {day}
                            </div>
                          ))}
                        </div>
                        {/* Grid */}
                        {monthGrid.map((week, weekIdx) => (
                          <div key={weekIdx} className="grid grid-cols-7 border-t">
                            {week.map((day, dayIdx) => {
                              if (!day) {
                                return <div key={dayIdx} className="p-2 bg-muted/30 min-h-[60px]" />;
                              }

                              const dayNumber = parseInt(day.date.split("-")[2], 10);
                              const isSelected = selectedAvailabilityDate === day.date;
                              const hasSlots = day.slotCount > 0;
                              const isWeekend = dayIdx === 0 || dayIdx === 6;
                              const today = new Date();
                              const dayDate = new Date(availabilityYear, availabilityMonth - 1, dayNumber);
                              const isPast = dayDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());

                              return (
                                <div
                                  key={dayIdx}
                                  className={`p-2 min-h-[60px] cursor-pointer transition-colors border-l first:border-l-0 ${
                                    isSelected
                                      ? "bg-primary/20 border-primary"
                                      : hasSlots
                                      ? "bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50"
                                      : isPast || isWeekend
                                      ? "bg-muted/30"
                                      : "hover:bg-muted/50"
                                  }`}
                                  onClick={() => !isPast && handleDayClick(day.date)}
                                >
                                  <div className={`text-sm font-medium ${isPast ? "text-muted-foreground" : ""}`}>
                                    {dayNumber}
                                  </div>
                                  {hasSlots && !isPast && (
                                    <div className="mt-1">
                                      <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                        {day.slotCount} slots
                                      </Badge>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-green-100 dark:bg-green-950/30 border rounded" />
                        <span>Available</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-muted/30 border rounded" />
                        <span>Unavailable / Past</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Day slots */}
                  <div className="w-1/3 flex flex-col min-h-0 border-l pl-4">
                    {selectedAvailabilityDate ? (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-sm">
                            {format(parseISO(selectedAvailabilityDate), "EEEE, MMMM d, yyyy")}
                          </h3>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDebugBusy}
                            disabled={isDebugging}
                            title="Debug why this time is available/busy"
                          >
                            {isDebugging ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <Bug className="h-4 w-4" />
                            )}
                          </Button>
                        </div>

                        {/* Debug result panel */}
                        {debugResult && (
                          <div className="mb-3 p-2 rounded border bg-muted/50 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-muted-foreground">Debug Info</span>
                              <label className="flex items-center gap-1 text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={debugOverlapEnabled}
                                  onChange={(e) => setDebugOverlapEnabled(e.target.checked)}
                                  className="h-3 w-3"
                                />
                                <span>Overlap detail</span>
                              </label>
                            </div>
                            <div>Busy Source: <span className="font-mono">{debugResult.busySource}</span></div>
                            <div>FreeBusy intervals: <span className="font-mono">{debugResult.freebusyCount}</span></div>
                            <div>Events busy count: <span className="font-mono">{debugResult.eventsCount}</span></div>
                            <div className="text-muted-foreground truncate" title={debugResult.calendarsChecked.join(", ")}>
                              Calendars: {debugResult.calendarsChecked.length}
                            </div>
                            
                            {/* Extended debug info when overlap debugging is enabled */}
                            {debugResult.debug && (
                              <div className="mt-2 pt-2 border-t border-muted space-y-1">
                                <div className="font-medium text-muted-foreground">Overlap Analysis</div>
                                <div>Day range: <span className="font-mono text-[10px]">{debugResult.debug.dayStartIso?.slice(11, 16)} – {debugResult.debug.dayEndIso?.slice(11, 16)}</span></div>
                                <div>Raw busy: <span className="font-mono">{debugResult.debug.rawBusyCount}</span> → Merged: <span className="font-mono">{debugResult.debug.mergedBusyCount}</span></div>
                                
                                {debugResult.debug.first3Busy?.length > 0 && (
                                  <div>
                                    <div className="text-muted-foreground mt-1">Busy blocks:</div>
                                    {debugResult.debug.first3Busy.map((b, i) => (
                                      <div key={i} className="font-mono text-[10px] text-destructive">
                                        {new Date(b.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} – {new Date(b.end).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                
                                <div className="text-muted-foreground mt-1">
                                  Candidates: {debugResult.debug.candidateSlots?.length || 0} → 
                                  Filtered: {debugResult.debug.filteredSlots?.length || 0}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {daySlotsError ? (
                          <div className="text-center py-6">
                            <XCircle className="h-8 w-8 mx-auto mb-2 text-destructive opacity-50" />
                            <p className="text-sm text-destructive">{daySlotsError}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => viewingCalendars && fetchDaySlots(viewingCalendars, selectedAvailabilityDate, availabilityDuration)}
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Retry
                            </Button>
                          </div>
                        ) : isLoadingDaySlots ? (
                          <div className="flex items-center justify-center py-8 text-muted-foreground">
                            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                            Loading slots...
                          </div>
                        ) : daySlots.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No available slots on this day.</p>
                          </div>
                        ) : (
                          <ScrollArea className="flex-1">
                            <div className="space-y-2 pr-2">
                              {daySlots.map((slot, idx) => (
                                <div
                                  key={idx}
                                  className="p-3 rounded border bg-card text-sm flex items-center gap-2"
                                >
                                  <Clock className="h-4 w-4 text-muted-foreground" />
                                  <span>{slot.label}</span>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        )}
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">Select a day to view available slots</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
