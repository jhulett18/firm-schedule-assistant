import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SystemStatus {
  lawmaticsConnected: boolean;
  calendarConnected: boolean;
  roomsCount: number;
  meetingTypesCount: number;
  presetsCount: number;
}

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  required: boolean;
  href: string;
  ctaLabel: string;
}

export function useDashboardData() {
  const { internalUser } = useAuth();

  // Fetch Lawmatics connection
  const { data: lawmaticsConnection, isLoading: loadingLawmatics } = useQuery({
    queryKey: ["lawmatics-connection-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lawmatics_connections")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  // Fetch calendar connection for current user
  const { data: calendarConnection, isLoading: loadingCalendar } = useQuery({
    queryKey: ["calendar-connection-status", internalUser?.id],
    queryFn: async () => {
      if (!internalUser?.id) return false;
      const { data, error } = await supabase
        .from("calendar_connections")
        .select("id")
        .eq("user_id", internalUser.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!internalUser?.id,
  });

  // Fetch rooms count
  const { data: roomsCount, isLoading: loadingRooms } = useQuery({
    queryKey: ["rooms-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("rooms")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch meeting types count
  const { data: meetingTypesCount, isLoading: loadingMeetingTypes } = useQuery({
    queryKey: ["meeting-types-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("meeting_types")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch presets count
  const { data: presetsCount, isLoading: loadingPresets } = useQuery({
    queryKey: ["presets-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pairing_presets")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch recent meetings
  const { data: recentMeetings, isLoading: loadingMeetings } = useQuery({
    queryKey: ["recent-meetings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select(`
          id,
          status,
          duration_minutes,
          location_mode,
          start_datetime,
          created_at,
          external_attendees,
          meeting_types (name),
          booking_requests (public_token, status)
        `)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const systemStatus: SystemStatus = {
    lawmaticsConnected: lawmaticsConnection ?? false,
    calendarConnected: calendarConnection ?? false,
    roomsCount: roomsCount ?? 0,
    meetingTypesCount: meetingTypesCount ?? 0,
    presetsCount: presetsCount ?? 0,
  };

  const setupSteps: SetupStep[] = [
    {
      id: "lawmatics",
      label: "Connect Lawmatics",
      description: "Required for creating calendar events when clients confirm bookings",
      completed: systemStatus.lawmaticsConnected,
      required: true,
      href: "/admin/settings",
      ctaLabel: "Connect Lawmatics",
    },
    {
      id: "calendar",
      label: "Connect Calendar",
      description: "Required for checking availability and suggesting time slots",
      completed: systemStatus.calendarConnected,
      required: true,
      href: "/admin/settings#calendar",
      ctaLabel: "Connect Calendar",
    },
    {
      id: "rooms",
      label: "Add Conference Rooms",
      description: "Configure rooms for in-person meetings",
      completed: systemStatus.roomsCount > 0,
      required: false,
      href: "/admin/rooms",
      ctaLabel: "Add Rooms",
    },
    {
      id: "meeting-types",
      label: "Add Meeting Types",
      description: "Define the types of meetings you offer",
      completed: systemStatus.meetingTypesCount > 0,
      required: false,
      href: "/admin/meeting-types",
      ctaLabel: "Add Meeting Types",
    },
    {
      id: "presets",
      label: "Create Pairing Presets",
      description: "Optional: Save common attorney + support staff combinations",
      completed: systemStatus.presetsCount > 0,
      required: false,
      href: "/admin/presets",
      ctaLabel: "Create Presets",
    },
  ];

  const completedSteps = setupSteps.filter((s) => s.completed).length;
  const progressPercent = Math.round((completedSteps / setupSteps.length) * 100);

  const getNextAction = () => {
    if (!systemStatus.lawmaticsConnected) {
      return {
        label: "Connect Lawmatics",
        description: "Connect your Lawmatics account to enable appointment creation",
        href: "/admin/settings",
        variant: "destructive" as const,
      };
    }
    if (!systemStatus.calendarConnected) {
      return {
        label: "Connect Calendar",
        description: "Connect Google Calendar to check availability",
        href: "/admin/settings#calendar",
        variant: "default" as const,
      };
    }
    if (systemStatus.meetingTypesCount === 0) {
      return {
        label: "Add Meeting Types",
        description: "Create at least one meeting type to get started",
        href: "/admin/meeting-types",
        variant: "default" as const,
      };
    }
    return {
      label: "Create Booking Request",
      description: "You're all set! Create a booking request for a client",
      href: "/requests/new",
      variant: "default" as const,
    };
  };

  const isLoading =
    loadingLawmatics ||
    loadingCalendar ||
    loadingRooms ||
    loadingMeetingTypes ||
    loadingPresets ||
    loadingMeetings;

  return {
    systemStatus,
    setupSteps,
    progressPercent,
    nextAction: getNextAction(),
    recentMeetings: recentMeetings || [],
    isLoading,
  };
}
