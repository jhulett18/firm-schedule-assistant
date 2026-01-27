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

interface NormalizedBusy {
  startMs: number;
  endMs: number;
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

// Get busy intervals using Microsoft Graph API getSchedule
async function getBusyIntervals(
  accessToken: string,
  userEmail: string,
  timeMin: string,
  timeMax: string
): Promise<{ busy: BusyInterval[]; error: string | null }> {
  // Microsoft Graph API getSchedule endpoint
  const response = await fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      schedules: [userEmail],
      startTime: {
        dateTime: timeMin,
        timeZone: "UTC",
      },
      endTime: {
        dateTime: timeMax,
        timeZone: "UTC",
      },
      availabilityViewInterval: 15, // 15-minute intervals
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

  // Process schedule items from response
  for (const schedule of data.value || []) {
    if (schedule.scheduleItems) {
      for (const item of schedule.scheduleItems) {
        // Status can be: free, tentative, busy, oof (out of office), workingElsewhere, unknown
        // We treat tentative, busy, oof, workingElsewhere as busy
        if (item.status !== "free") {
          allBusy.push({
            start: item.start?.dateTime || "",
            end: item.end?.dateTime || "",
          });
        }
      }
    }
  }

  return { busy: allBusy, error: null };
}

// Get busy intervals by listing events directly (alternative approach)
async function listEventsBusyIntervals(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string
): Promise<{ busy: BusyInterval[]; error: string | null; eventsCount: number }> {
  const allBusy: BusyInterval[] = [];
  let totalEventsCount = 0;

  for (const calendarId of calendarIds) {
    const params = new URLSearchParams({
      startDateTime: timeMin,
      endDateTime: timeMax,
      $top: "250",
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
        return { busy: [], error: "AUTH_EXPIRED", eventsCount: 0 };
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

      totalEventsCount++;

      const startDateTime = event.start?.dateTime;
      const endDateTime = event.end?.dateTime;

      if (event.isAllDay) {
        // All-day events
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

  console.log(`Microsoft Events API found ${totalEventsCount} events creating ${allBusy.length} busy intervals`);
  return { busy: allBusy, error: null, eventsCount: totalEventsCount };
}

// Normalize busy intervals to epoch ms and merge overlapping/adjacent ones
function normalizeBusyIntervals(intervals: BusyInterval[]): NormalizedBusy[] {
  if (intervals.length === 0) return [];

  const normalized: NormalizedBusy[] = intervals.map(interval => ({
    startMs: new Date(interval.start).getTime(),
    endMs: new Date(interval.end).getTime(),
  }));

  normalized.sort((a, b) => a.startMs - b.startMs);

  const merged: NormalizedBusy[] = [];
  let current = { ...normalized[0] };

  for (let i = 1; i < normalized.length; i++) {
    const next = normalized[i];
    if (next.startMs <= current.endMs + 60000) {
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

function slotOverlapsBusy(slotStartMs: number, slotEndMs: number, busyIntervals: NormalizedBusy[]): boolean {
  for (const busy of busyIntervals) {
    if (slotStartMs < busy.endMs && slotEndMs > busy.startMs) {
      return true;
    }
  }
  return false;
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
  businessEnd: string,
  debugMode: boolean = false
): { slots: TimeSlot[]; debug?: any } {
  const slots: TimeSlot[] = [];
  const now = new Date();
  const minimumNoticeMs = 60 * 60 * 1000;
  const minimumNoticeTime = now.getTime() + minimumNoticeMs;
  const slotDurationMs = durationMinutes * 60 * 1000;
  const slotIncrementMs = 30 * 60 * 1000;

  const dayOfWeek = dayDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { slots, debug: debugMode ? { skipped: "weekend" } : undefined };
  }

  const [startHour, startMin] = businessStart.split(":").map(Number);
  const [endHour, endMin] = businessEnd.split(":").map(Number);

  const dayStartDate = new Date(dayDate);
  dayStartDate.setHours(startHour, startMin, 0, 0);
  const dayStartMs = dayStartDate.getTime();

  const dayEndDate = new Date(dayDate);
  dayEndDate.setHours(endHour, endMin, 0, 0);
  const dayEndMs = dayEndDate.getTime();

  const normalizedBusy = normalizeBusyIntervals(busyIntervals);

  const debugInfo: any = debugMode ? {
    dayStartIso: dayStartDate.toISOString(),
    dayEndIso: dayEndDate.toISOString(),
    dayStartMs,
    dayEndMs,
    rawBusyCount: busyIntervals.length,
    mergedBusyCount: normalizedBusy.length,
    first3Busy: normalizedBusy.slice(0, 3).map(b => ({
      start: new Date(b.startMs).toISOString(),
      end: new Date(b.endMs).toISOString(),
    })),
    candidateSlots: [],
    filteredSlots: [],
  } : undefined;

  let currentSlotStartMs = dayStartMs;

  while (currentSlotStartMs + slotDurationMs <= dayEndMs) {
    const slotEndMs = currentSlotStartMs + slotDurationMs;

    if (currentSlotStartMs >= minimumNoticeTime) {
      const slotStartDate = new Date(currentSlotStartMs);
      const slotEndDate = new Date(slotEndMs);

      if (debugMode && debugInfo.candidateSlots.length < 5) {
        debugInfo.candidateSlots.push({
          start: slotStartDate.toISOString(),
          end: slotEndDate.toISOString(),
          label: `${formatTimeLabel(slotStartDate)} – ${formatTimeLabel(slotEndDate)}`,
        });
      }

      const overlaps = slotOverlapsBusy(currentSlotStartMs, slotEndMs, normalizedBusy);

      if (!overlaps) {
        const slot: TimeSlot = {
          start: slotStartDate.toISOString(),
          end: slotEndDate.toISOString(),
          label: `${formatTimeLabel(slotStartDate)} – ${formatTimeLabel(slotEndDate)}`,
        };
        slots.push(slot);

        if (debugMode && debugInfo.filteredSlots.length < 5) {
          debugInfo.filteredSlots.push(slot);
        }
      }
    }

    currentSlotStartMs += slotIncrementMs;
  }

  return { slots, debug: debugInfo };
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
    const dateStr = body.date;
    const durationMinutes = body.durationMinutes || 60;
    const businessStart = body.businessStart || "09:00";
    const businessEnd = body.businessEnd || "17:00";
    const debugMode = body.debug === true;

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

    const effectiveDebugMode = debugMode && isAdmin;

    // Load busy source setting
    const { data: busySourceSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "availability_busy_source")
      .maybeSingle();

    const busySource = busySourceSetting?.value || "events";
    console.log(`Using busy source: ${busySource}`);

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
        JSON.stringify({ error: "No Microsoft connection found", date: dateStr, slots: [], calendarsChecked: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine calendars to check
    const calendarsToCheck =
      Array.isArray(body.calendarIds) && body.calendarIds.length
        ? body.calendarIds
        : (connection.selected_calendar_ids?.length ? connection.selected_calendar_ids : ["primary"]);

    console.log("Calendars to check for day availability:", calendarsToCheck);

    let accessToken = connection.access_token;
    const now = new Date();
    const tokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

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

    console.log(`Fetching Microsoft availability for ${dateStr}, from ${timeMin} to ${timeMax}`);

    let busyIntervals: BusyInterval[] = [];
    let busyError: string | null = null;
    let eventsCount = 0;

    // Use events-based approach (more reliable for Microsoft)
    let eventsResult = await listEventsBusyIntervals(accessToken, calendarsToCheck, timeMin, timeMax);

    if (eventsResult.error === "AUTH_EXPIRED" && connection.refresh_token) {
      console.log("Got 401, attempting token refresh...");
      const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
      if (refreshResult) {
        eventsResult = await listEventsBusyIntervals(refreshResult.access_token, calendarsToCheck, timeMin, timeMax);
      } else {
        eventsResult = { busy: [], error: "Token refresh failed", eventsCount: 0 };
      }
    }

    busyIntervals = eventsResult.busy;
    busyError = eventsResult.error;
    eventsCount = eventsResult.eventsCount;

    if (busyError && busyError !== "AUTH_EXPIRED") {
      return new Response(
        JSON.stringify({ error: busyError, date: dateStr, slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${busyIntervals.length} busy intervals before filtering`);

    const { slots, debug } = suggestSlotsForDay(
      busyIntervals,
      dayDate,
      durationMinutes,
      businessStart,
      businessEnd,
      effectiveDebugMode
    );

    console.log(`Generated ${slots.length} available slots`);

    const response: any = {
      date: dateStr,
      slots,
      error: null,
      calendarsChecked: calendarsToCheck,
      busySource: "events",
      busyIntervalsCount: busyIntervals.length,
      eventsCount,
    };

    if (effectiveDebugMode && debug) {
      response.debug = debug;
    }

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in microsoft-availability-day:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", date: "", slots: [] }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
