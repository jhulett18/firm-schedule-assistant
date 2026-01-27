import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BusyInterval {
  start: string;
  end: string;
}

interface DaySummary {
  date: string; // YYYY-MM-DD
  slotCount: number;
  firstSlotStart?: string;
  lastSlotStart?: string;
}

interface TimeSlot {
  start: string;
  end: string;
}

async function refreshAccessToken(
  connectionId: string,
  refreshToken: string,
  supabase: any
): Promise<{ access_token: string; expires_at: string } | null> {
  const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
  const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");

  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    console.error("Missing Microsoft OAuth credentials for refresh");
    return null;
  }

  try {
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
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

// Get busy intervals by listing events from Microsoft Graph API
async function getBusyIntervals(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string
): Promise<{ busy: BusyInterval[]; error: string | null }> {
  const allBusy: BusyInterval[] = [];

  for (const calendarId of calendarIds) {
    const params = new URLSearchParams({
      startDateTime: timeMin,
      endDateTime: timeMax,
      $top: "500",
      $orderby: "start/dateTime",
      $select: "id,start,end,showAs,isCancelled,isAllDay",
    });

    // Use default calendar if calendarId is "primary" or empty
    const basePath = calendarId && calendarId !== "primary"
      ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
      : "https://graph.microsoft.com/v1.0/me/calendarView";

    const url = `${basePath}?${params}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { busy: [], error: "AUTH_EXPIRED" };
      }
      const text = await response.text();
      console.error(`Failed to fetch events for calendar ${calendarId}: ${text}`);
      continue;
    }

    const data = await response.json();
    const events = data.value || [];

    for (const event of events) {
      if (event.isCancelled) {
        continue;
      }

      // showAs: free, tentative, busy, oof, workingElsewhere, unknown
      // Skip free events
      if (event.showAs === "free") {
        continue;
      }

      const startDateTime = event.start?.dateTime;
      const endDateTime = event.end?.dateTime;

      if (event.isAllDay) {
        const startDate = new Date(startDateTime);
        const endDate = new Date(endDateTime);
        allBusy.push({
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        });
      } else if (startDateTime && endDateTime) {
        allBusy.push({
          start: startDateTime.endsWith("Z") ? startDateTime : startDateTime + "Z",
          end: endDateTime.endsWith("Z") ? endDateTime : endDateTime + "Z",
        });
      }
    }
  }

  return { busy: allBusy, error: null };
}

// Suggest slots for a single day
function suggestSlotsForDay(
  busyIntervals: BusyInterval[],
  dayDate: Date,
  durationMinutes: number,
  businessStart: string,
  businessEnd: string,
  timezone: string
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const now = new Date();
  const minimumNoticeTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour notice

  // Skip weekends
  const dayOfWeek = dayDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return slots;
  }

  // Parse business hours
  const [startHour, startMin] = businessStart.split(":").map(Number);
  const [endHour, endMin] = businessEnd.split(":").map(Number);

  const dayStart = new Date(dayDate);
  dayStart.setHours(startHour, startMin, 0, 0);

  const dayEnd = new Date(dayDate);
  dayEnd.setHours(endHour, endMin, 0, 0);

  // Sort busy intervals
  const sortedBusy = busyIntervals
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((b) => b.start < dayEnd && b.end > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Find free slots
  let slotStart = dayStart;

  for (const busy of sortedBusy) {
    if (busy.start > slotStart) {
      const gapEnd = busy.start;
      const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (1000 * 60);

      if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
        let currentSlotStart = new Date(slotStart);
        while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= gapEnd.getTime()) {
          if (currentSlotStart >= minimumNoticeTime) {
            const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
            slots.push({
              start: currentSlotStart.toISOString(),
              end: slotEnd.toISOString(),
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

  // Check remaining time
  if (slotStart < dayEnd) {
    const gapDuration = (dayEnd.getTime() - slotStart.getTime()) / (1000 * 60);
    if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
      let currentSlotStart = new Date(slotStart);
      while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
        if (currentSlotStart >= minimumNoticeTime) {
          const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
          slots.push({
            start: currentSlotStart.toISOString(),
            end: slotEnd.toISOString(),
          });
        }
        currentSlotStart = new Date(currentSlotStart.getTime() + 30 * 60 * 1000);
      }
    }
  }

  return slots;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase configuration");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized", days: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", days: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: callerUser, error: callerError } = await supabase
      .from("users")
      .select("id, auth_user_id")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "User not found", days: [] }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STRICT USER SCOPING
    const targetInternalUserId = callerUser.id;

    const body = await req.json().catch(() => ({}));
    const month = body.month || new Date().getMonth() + 1; // 1-12
    const year = body.year || new Date().getFullYear();
    const durationMinutes = body.durationMinutes || 60;
    const businessStart = body.businessStart || "09:00";
    const businessEnd = body.businessEnd || "17:00";
    const timezone = body.timezone || "America/New_York";

    console.log("Loading Microsoft connection for caller:", targetInternalUserId);

    // Load Microsoft connection
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", targetInternalUserId)
      .eq("provider", "microsoft")
      .maybeSingle();

    if (connError) throw connError;

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "No Microsoft connection found", days: [], calendarsChecked: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine calendars to check
    const calendarsToCheck =
      Array.isArray(body.calendarIds) && body.calendarIds.length
        ? body.calendarIds
        : (connection.selected_calendar_ids?.length ? connection.selected_calendar_ids : ["primary"]);

    console.log("Calendars to check for availability:", calendarsToCheck);

    let accessToken = connection.access_token;
    const now = new Date();
    const tokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    // Refresh token if needed
    if (tokenExpiresAt && tokenExpiresAt < fiveMinutesFromNow && connection.refresh_token) {
      console.log("Token expired or expiring soon, refreshing...");
      const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
      if (refreshResult) {
        accessToken = refreshResult.access_token;
      }
    }

    // Calculate month range
    const timeMin = new Date(year, month - 1, 1, 0, 0, 0, 0).toISOString();
    const timeMax = new Date(year, month, 1, 0, 0, 0, 0).toISOString();

    console.log(`Fetching Microsoft availability for month ${month}/${year}, from ${timeMin} to ${timeMax}`);

    // Fetch busy intervals
    let busyResult = await getBusyIntervals(accessToken, calendarsToCheck, timeMin, timeMax);

    // Retry on 401
    if (busyResult.error === "AUTH_EXPIRED" && connection.refresh_token) {
      console.log("Got 401, attempting token refresh...");
      const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
      if (refreshResult) {
        busyResult = await getBusyIntervals(refreshResult.access_token, calendarsToCheck, timeMin, timeMax);
      } else {
        busyResult = { busy: [], error: "Token refresh failed" };
      }
    }

    if (busyResult.error && busyResult.error !== "AUTH_EXPIRED") {
      return new Response(
        JSON.stringify({ error: busyResult.error, days: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process each day of the month
    const days: DaySummary[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const daySlots = suggestSlotsForDay(
        busyResult.busy,
        dayDate,
        durationMinutes,
        businessStart,
        businessEnd,
        timezone
      );

      days.push({
        date: dateStr,
        slotCount: daySlots.length,
        firstSlotStart: daySlots.length > 0 ? daySlots[0].start : undefined,
        lastSlotStart: daySlots.length > 0 ? daySlots[daySlots.length - 1].start : undefined,
      });
    }

    return new Response(
      JSON.stringify({ days, error: null, calendarsChecked: calendarsToCheck }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in microsoft-availability-month:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", days: [] }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
