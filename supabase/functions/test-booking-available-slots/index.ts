import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestAvailableSlotsRequest {
  meetingId: string;
  dateCursor?: string;
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

// Refresh access token helper
async function refreshAccessToken(
  connectionId: string,
  refreshToken: string,
  supabase: any
): Promise<{ access_token: string; expires_at: string } | null> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error("Missing Google OAuth credentials for refresh");
    return null;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Token refresh failed:", await tokenResponse.text());
      return null;
    }

    const tokens = await tokenResponse.json();
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("calendar_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: tokenExpiresAt,
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    if (updateError) {
      console.error("Failed to update refreshed token:", updateError);
      return null;
    }

    return { access_token: tokens.access_token, expires_at: tokenExpiresAt };
  } catch (err) {
    console.error("Error during token refresh:", err);
    return null;
  }
}

async function getBusyIntervalsForCalendar(
  connection: any,
  calendarId: string,
  start: string,
  end: string,
  supabase: any
): Promise<BusyInterval[]> {
  let accessToken = connection.access_token;

  // Check if token needs refresh
  const tokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (tokenExpiresAt && tokenExpiresAt < fiveMinutesFromNow && connection.refresh_token) {
    const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
    if (refreshResult) {
      accessToken = refreshResult.access_token;
    }
  }

  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start,
      timeMax: end,
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    console.error("Google FreeBusy API error:", await response.text());
    return [];
  }

  const data = await response.json();
  const calendar = data.calendars?.[calendarId];
  return calendar?.busy || [];
}

// Helper to create a Date object representing a specific local time in a timezone
function createDateInTimezone(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  // Create an ISO string without timezone
  const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  // Create a reference date in UTC
  const utcDate = new Date(isoString + 'Z');

  // Format to see what this UTC time looks like in the target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(utcDate);
  const tzYear = Number(parts.find(p => p.type === 'year')!.value);
  const tzMonth = Number(parts.find(p => p.type === 'month')!.value);
  const tzDay = Number(parts.find(p => p.type === 'day')!.value);
  const tzHour = Number(parts.find(p => p.type === 'hour')!.value);
  const tzMinute = Number(parts.find(p => p.type === 'minute')!.value);
  const tzSecond = Number(parts.find(p => p.type === 'second')!.value);

  // Calculate the offset between what we wanted and what we got
  const offset =
    (year - tzYear) * 365 * 24 * 60 * 60 * 1000 +
    (month - tzMonth) * 30 * 24 * 60 * 60 * 1000 +
    (day - tzDay) * 24 * 60 * 60 * 1000 +
    (hour - tzHour) * 60 * 60 * 1000 +
    (minute - tzMinute) * 60 * 1000 +
    (0 - tzSecond) * 1000;

  // Return the UTC date adjusted by the offset
  return new Date(utcDate.getTime() + offset);
}

function suggestSlots(
  busyIntervals: BusyInterval[],
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  timezone: string = "America/New_York"
): TimeSlot[] {
  const businessHoursStart = "09:00";
  const businessHoursEnd = "17:00";
  const lunchStart = "12:00";
  const lunchEnd = "13:00";
  const minimumNoticeMinutes = 60;

  const slots: TimeSlot[] = [];
  const now = new Date();
  const minimumNoticeTime = new Date(now.getTime() + minimumNoticeMinutes * 60 * 1000);

  const sortedBusy = busyIntervals
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (currentDate <= endDate && slots.length < 30) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    const [startHour, startMin] = businessHoursStart.split(":").map(Number);
    const [endHour, endMin] = businessHoursEnd.split(":").map(Number);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();

    const dayStart = createDateInTimezone(year, month, day, startHour, startMin, timezone);
    const dayEnd = createDateInTimezone(year, month, day, endHour, endMin, timezone);

    const [lunchStartHour, lunchStartMin] = lunchStart.split(":").map(Number);
    const [lunchEndHour, lunchEndMin] = lunchEnd.split(":").map(Number);
    const lunchStartTime = createDateInTimezone(year, month, day, lunchStartHour, lunchStartMin, timezone);
    const lunchEndTime = createDateInTimezone(year, month, day, lunchEndHour, lunchEndMin, timezone);

    const dayBusy = sortedBusy.filter((b) => b.start < dayEnd && b.end > dayStart);
    dayBusy.push({ start: lunchStartTime, end: lunchEndTime });
    dayBusy.sort((a, b) => a.start.getTime() - b.start.getTime());

    let slotStart = dayStart;

    for (const busy of dayBusy) {
      if (busy.start > slotStart) {
        const gapEnd = busy.start;
        const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (1000 * 60);

        if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
          let currentSlotStart = new Date(slotStart);
          while (
            currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= gapEnd.getTime() &&
            slots.length < 30
          ) {
            if (currentSlotStart >= minimumNoticeTime) {
              const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
              const dayLabel = currentSlotStart.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              });
              const timeLabel = currentSlotStart.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
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

    if (slotStart < dayEnd) {
      const gapDuration = (dayEnd.getTime() - slotStart.getTime()) / (1000 * 60);

      if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
        let currentSlotStart = new Date(slotStart);
        while (
          currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime() &&
          slots.length < 30
        ) {
          if (currentSlotStart >= minimumNoticeTime) {
            const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
            const dayLabel = currentSlotStart.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
            const timeLabel = currentSlotStart.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
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

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized", slots: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", slots: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request
    const body: TestAvailableSlotsRequest = await req.json();
    const { meetingId, dateCursor } = body;

    if (!meetingId) {
      return new Response(JSON.stringify({ error: "Meeting ID required", slots: [] }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch meeting with preferences
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("*, meeting_types(name), rooms(name, resource_email)")
      .eq("id", meetingId)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found", slots: [] }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get admin's test calendar ID from preferences
    const preferences = meeting.preferences as Record<string, any> || {};
    const adminCalendarId = preferences.admin_calendar_id;
    const adminCalendarUserId = preferences.admin_calendar_user_id;

    if (!adminCalendarId || !adminCalendarUserId) {
      return new Response(
        JSON.stringify({ error: "Test booking preferences not set", slots: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetching availability for calendar:", adminCalendarId);

    // Get calendar connection for the admin
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", adminCalendarUserId)
      .eq("provider", "google")
      .maybeSingle();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: "No Google calendar connection found", slots: [] }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchWindowDays = 14;
    const startDate = dateCursor ? new Date(dateCursor) : new Date();
    const endDate = new Date(startDate.getTime() + searchWindowDays * 24 * 60 * 60 * 1000);

    // Fetch busy intervals for the specific test calendar
    const busyIntervals = await getBusyIntervalsForCalendar(
      connection,
      adminCalendarId,
      startDate.toISOString(),
      endDate.toISOString(),
      supabase
    );

    console.log(`Found ${busyIntervals.length} busy intervals for calendar ${adminCalendarId}`);

    // Also check room availability if in-person
    if (meeting.location_mode === "InPerson" && meeting.rooms?.resource_email) {
      const roomBusy = await getBusyIntervalsForCalendar(
        connection,
        meeting.rooms.resource_email,
        startDate.toISOString(),
        endDate.toISOString(),
        supabase
      );
      busyIntervals.push(...roomBusy);
      console.log(`Added ${roomBusy.length} room busy intervals`);
    }

    // Generate available slots (using America/New_York timezone for business hours)
    const slots = suggestSlots(busyIntervals, startDate, endDate, meeting.duration_minutes, "America/New_York");

    console.log(`Returning ${slots.length} available slots`);

    return new Response(JSON.stringify({ slots }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in test-booking-available-slots:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", slots: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
