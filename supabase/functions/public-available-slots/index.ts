import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PublicAvailableSlotsRequest {
  token: string;
  dateCursor?: string; // ISO date string to start searching from
  clientTimezone?: string;
}

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

interface BusyInterval {
  start: string;
  end: string;
}

// Calendar Provider Interface
interface CalendarProvider {
  getBusyIntervals(accessToken: string, calendars: string[], start: string, end: string): Promise<BusyInterval[]>;
}

// Google Calendar Provider
const googleProvider: CalendarProvider = {
  async getBusyIntervals(accessToken: string, calendars: string[], start: string, end: string): Promise<BusyInterval[]> {
    const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: start,
        timeMax: end,
        items: calendars.map(id => ({ id })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google FreeBusy API error:", errorText);
      throw new Error(`Google Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    const allBusy: BusyInterval[] = [];

    for (const calendarId of Object.keys(data.calendars || {})) {
      const calendar = data.calendars[calendarId];
      if (calendar.busy) {
        allBusy.push(...calendar.busy);
      }
    }

    return allBusy;
  }
};

// Generate slots from busy intervals
function suggestSlots(
  busyIntervals: BusyInterval[],
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  clientTimezone: string
): TimeSlot[] {
  const businessHoursStart = "09:00";
  const businessHoursEnd = "17:00";
  const lunchStart = "12:00";
  const lunchEnd = "13:00";
  const minimumNoticeMinutes = 60;

  const slots: TimeSlot[] = [];
  const now = new Date();
  const minimumNoticeTime = new Date(now.getTime() + minimumNoticeMinutes * 60 * 1000);

  // Sort busy intervals by start time
  const sortedBusy = busyIntervals
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Iterate through each day
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (currentDate <= endDate && slots.length < 30) {
    // Skip weekends
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // Parse business hours for this day
    const [startHour, startMin] = businessHoursStart.split(":").map(Number);
    const [endHour, endMin] = businessHoursEnd.split(":").map(Number);

    const dayStart = new Date(currentDate);
    dayStart.setHours(startHour, startMin, 0, 0);

    const dayEnd = new Date(currentDate);
    dayEnd.setHours(endHour, endMin, 0, 0);

    // Parse lunch block
    const [lunchStartHour, lunchStartMin] = lunchStart.split(":").map(Number);
    const [lunchEndHour, lunchEndMin] = lunchEnd.split(":").map(Number);
    const lunchStartTime = new Date(currentDate);
    lunchStartTime.setHours(lunchStartHour, lunchStartMin, 0, 0);
    const lunchEndTime = new Date(currentDate);
    lunchEndTime.setHours(lunchEndHour, lunchEndMin, 0, 0);

    // Get busy intervals for this day
    const dayBusy = sortedBusy.filter(b => 
      b.start < dayEnd && b.end > dayStart
    );

    // Add lunch as a busy interval
    dayBusy.push({ start: lunchStartTime, end: lunchEndTime });
    dayBusy.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find free slots
    let slotStart = dayStart;

    for (const busy of dayBusy) {
      if (busy.start > slotStart) {
        const gapEnd = busy.start;
        const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (1000 * 60);
        
        if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
          let currentSlotStart = new Date(slotStart);
          while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= gapEnd.getTime() && slots.length < 30) {
            if (currentSlotStart >= minimumNoticeTime) {
              const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
              
              // Format label for client display
              const dayLabel = currentSlotStart.toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'short', 
                day: 'numeric' 
              });
              const timeLabel = currentSlotStart.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
              });
              
              slots.push({
                start: currentSlotStart.toISOString(),
                end: slotEnd.toISOString(),
                label: `${dayLabel} at ${timeLabel}`,
              });
            }
            currentSlotStart = new Date(currentSlotStart.getTime() + 30 * 60 * 1000);
          }
        }
      }
      
      if (busy.end > slotStart) {
        slotStart = busy.end;
      }
    }

    // Check for remaining time at end of day
    if (slotStart < dayEnd) {
      const gapDuration = (dayEnd.getTime() - slotStart.getTime()) / (1000 * 60);
      
      if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
        let currentSlotStart = new Date(slotStart);
        while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime() && slots.length < 30) {
          if (currentSlotStart >= minimumNoticeTime) {
            const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
            
            const dayLabel = currentSlotStart.toLocaleDateString('en-US', { 
              weekday: 'long', 
              month: 'short', 
              day: 'numeric' 
            });
            const timeLabel = currentSlotStart.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            });
            
            slots.push({
              start: currentSlotStart.toISOString(),
              end: slotEnd.toISOString(),
              label: `${dayLabel} at ${timeLabel}`,
            });
          }
          currentSlotStart = new Date(currentSlotStart.getTime() + 30 * 60 * 1000);
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return slots;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: PublicAvailableSlotsRequest = await req.json();
    const { token, dateCursor, clientTimezone = "America/New_York" } = body;

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required", slots: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetching available slots for token:", token);

    // 1. Fetch booking request and meeting info
    const { data: bookingRequest, error: brError } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();

    if (brError || !bookingRequest) {
      return new Response(
        JSON.stringify({ error: "Booking link not found", slots: [] }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate booking request status
    if (bookingRequest.status !== "Open") {
      return new Response(
        JSON.stringify({ error: "Booking is no longer open", slots: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(bookingRequest.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Booking link has expired", slots: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch meeting details
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        id,
        duration_minutes,
        host_attorney_user_id,
        room_id,
        location_mode,
        support_user_ids,
        search_window_days_used
      `)
      .eq("id", bookingRequest.meeting_id)
      .maybeSingle();

    if (meetingError || !meeting) {
      return new Response(
        JSON.stringify({ error: "Meeting not found", slots: [] }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Get room resource email if in-person
    let roomResourceEmail: string | null = null;
    if (meeting.location_mode === "InPerson" && meeting.room_id) {
      const { data: room } = await supabase
        .from("rooms")
        .select("resource_email")
        .eq("id", meeting.room_id)
        .maybeSingle();
      
      roomResourceEmail = room?.resource_email || null;
    }

    // 4. Build list of participant user IDs
    const participantUserIds: string[] = [];
    if (meeting.host_attorney_user_id) {
      participantUserIds.push(meeting.host_attorney_user_id);
    }
    if (meeting.support_user_ids && Array.isArray(meeting.support_user_ids)) {
      participantUserIds.push(...meeting.support_user_ids);
    }

    // 5. Get calendar connections for participants
    const { data: connections } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("provider", "google")
      .in("user_id", participantUserIds);

    const allBusyIntervals: BusyInterval[] = [];
    const searchWindowDays = meeting.search_window_days_used || 14;
    const startDate = dateCursor ? new Date(dateCursor) : new Date();
    const endDate = new Date(startDate.getTime() + searchWindowDays * 24 * 60 * 60 * 1000);

    // 6. Fetch busy intervals for each participant (server-side only)
    for (const connection of connections || []) {
      if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
        console.log(`Token expired for user ${connection.user_id}, skipping`);
        continue;
      }

      try {
        const { data: userData } = await supabase
          .from("users")
          .select("email")
          .eq("id", connection.user_id)
          .single();

        if (!userData?.email) continue;

        const calendars = [userData.email];
        const busy = await googleProvider.getBusyIntervals(
          connection.access_token,
          calendars,
          startDate.toISOString(),
          endDate.toISOString()
        );
        allBusyIntervals.push(...busy);
      } catch (err) {
        console.error(`Failed to get busy for user ${connection.user_id}:`, err);
      }
    }

    // 7. Check room availability if in-person meeting
    if (roomResourceEmail && connections && connections.length > 0) {
      const adminConnection = connections[0];
      try {
        const busy = await googleProvider.getBusyIntervals(
          adminConnection.access_token,
          [roomResourceEmail],
          startDate.toISOString(),
          endDate.toISOString()
        );
        allBusyIntervals.push(...busy);
      } catch (err) {
        console.error("Failed to check room availability:", err);
      }
    }

    // 8. Generate available slots (returns safe data only)
    const slots = suggestSlots(
      allBusyIntervals,
      startDate,
      endDate,
      meeting.duration_minutes,
      clientTimezone
    );

    console.log(`Found ${slots.length} available slots`);

    // Never return internal data like busy intervals, calendar IDs, or attendee info
    return new Response(JSON.stringify({ slots }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in public-available-slots:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", slots: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
