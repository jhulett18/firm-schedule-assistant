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

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

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

async function getBusyIntervals(
  accessToken: string,
  calendars: string[],
  timeMin: string,
  timeMax: string
): Promise<{ busy: BusyInterval[]; error: string | null }> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: calendars.map((id) => ({ id })),
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      return { busy: [], error: "AUTH_EXPIRED" };
    }
    const text = await response.text();
    return { busy: [], error: `API error ${response.status}: ${text}` };
  }

  const data = await response.json();
  const allBusy: BusyInterval[] = [];

  for (const calendarId of Object.keys(data.calendars || {})) {
    const calendar = data.calendars[calendarId];
    if (calendar.busy) {
      allBusy.push(...calendar.busy);
    }
  }

  return { busy: allBusy, error: null };
}

function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, "0");
  return `${h}:${m} ${ampm}`;
}

function suggestSlotsForDay(
  busyIntervals: BusyInterval[],
  dayDate: Date,
  durationMinutes: number,
  businessStart: string,
  businessEnd: string
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
              label: `${formatTimeLabel(currentSlotStart)} – ${formatTimeLabel(slotEnd)}`,
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
            label: `${formatTimeLabel(currentSlotStart)} – ${formatTimeLabel(slotEnd)}`,
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
      return new Response(JSON.stringify({ error: "Unauthorized", date: "", slots: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", date: "", slots: [] }), {
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
      return new Response(JSON.stringify({ error: "User not found", date: "", slots: [] }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const targetInternalUserId = body.internalUserId || callerUser.id;
    const dateStr = body.date; // YYYY-MM-DD
    const durationMinutes = body.durationMinutes || 60;
    const businessStart = body.businessStart || "09:00";
    const businessEnd = body.businessEnd || "17:00";
    const timezone = body.timezone || "America/New_York";
    const calendarIds = body.calendarIds || ["primary"];

    if (!dateStr) {
      return new Response(
        JSON.stringify({ error: "Missing 'date' parameter", date: "", slots: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin check
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    const isAdmin = !!adminRole;

    if (targetInternalUserId !== callerUser.id && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden", date: dateStr, slots: [] }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Google connection
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", targetInternalUserId)
      .eq("provider", "google")
      .maybeSingle();

    if (connError) throw connError;

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "No Google connection found", date: dateStr, slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Parse date and calculate range
    const [year, month, day] = dateStr.split("-").map(Number);
    const dayDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const timeMin = dayDate.toISOString();
    const nextDay = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    const timeMax = nextDay.toISOString();

    console.log(`Fetching availability for ${dateStr}, from ${timeMin} to ${timeMax}`);

    // Fetch busy intervals
    let busyResult = await getBusyIntervals(accessToken, calendarIds, timeMin, timeMax);

    // Retry on 401
    if (busyResult.error === "AUTH_EXPIRED" && connection.refresh_token) {
      console.log("Got 401, attempting token refresh...");
      const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
      if (refreshResult) {
        busyResult = await getBusyIntervals(refreshResult.access_token, calendarIds, timeMin, timeMax);
      } else {
        busyResult = { busy: [], error: "Token refresh failed" };
      }
    }

    if (busyResult.error && busyResult.error !== "AUTH_EXPIRED") {
      return new Response(
        JSON.stringify({ error: busyResult.error, date: dateStr, slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const slots = suggestSlotsForDay(
      busyResult.busy,
      dayDate,
      durationMinutes,
      businessStart,
      businessEnd
    );

    return new Response(
      JSON.stringify({ date: dateStr, slots, error: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in google-availability-day:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", date: "", slots: [] }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
