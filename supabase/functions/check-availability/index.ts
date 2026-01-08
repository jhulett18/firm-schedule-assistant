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

interface AvailabilityRequest {
  participantUserIds: string[];
  roomResourceEmail?: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  preferences?: {
    businessHoursStart?: string; // "09:00"
    businessHoursEnd?: string; // "17:00"
    lunchStart?: string; // "12:00"
    lunchEnd?: string; // "13:00"
    minimumNoticeMinutes?: number;
    timezone?: string;
  };
}

interface TimeSlot {
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

    // Update the connection with new token
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

    console.log("Token refreshed successfully for connection:", connectionId);
    return { access_token: tokens.access_token, expires_at: tokenExpiresAt };
  } catch (err) {
    console.error("Error during token refresh:", err);
    return null;
  }
}

// Calendar Provider Interface
interface CalendarProvider {
  getBusyIntervals(accessToken: string, calendars: string[], start: string, end: string): Promise<BusyInterval[]>;
}

// Google Calendar Provider with retry on 401
async function getBusyIntervalsWithRetry(
  connection: any,
  calendars: string[],
  start: string,
  end: string,
  supabase: any
): Promise<{ busy: BusyInterval[]; newAccessToken?: string }> {
  let accessToken = connection.access_token;

  const doRequest = async (token: string) => {
    const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: start,
        timeMax: end,
        items: calendars.map(id => ({ id })),
      }),
    });
    return response;
  };

  let response = await doRequest(accessToken);

  // If 401 and we have refresh token, refresh and retry
  if (response.status === 401 && connection.refresh_token) {
    console.log(`Got 401 for connection ${connection.id}, attempting refresh...`);
    const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
    if (refreshResult) {
      accessToken = refreshResult.access_token;
      response = await doRequest(accessToken);
    }
  }

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
    if (calendar.errors) {
      console.warn(`Errors for calendar ${calendarId}:`, calendar.errors);
    }
  }

  return { busy: allBusy, newAccessToken: accessToken !== connection.access_token ? accessToken : undefined };
}

// Suggest available slots based on busy intervals
function suggestSlots(
  busyIntervals: BusyInterval[],
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  preferences: AvailabilityRequest["preferences"] = {}
): TimeSlot[] {
  const {
    businessHoursStart = "09:00",
    businessHoursEnd = "17:00",
    lunchStart,
    lunchEnd,
    minimumNoticeMinutes = 60,
    timezone = "America/New_York",
  } = preferences;

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

  while (currentDate <= endDate) {
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

    // Parse lunch block if specified
    let lunchStartTime: Date | null = null;
    let lunchEndTime: Date | null = null;
    if (lunchStart && lunchEnd) {
      const [lunchStartHour, lunchStartMin] = lunchStart.split(":").map(Number);
      const [lunchEndHour, lunchEndMin] = lunchEnd.split(":").map(Number);
      lunchStartTime = new Date(currentDate);
      lunchStartTime.setHours(lunchStartHour, lunchStartMin, 0, 0);
      lunchEndTime = new Date(currentDate);
      lunchEndTime.setHours(lunchEndHour, lunchEndMin, 0, 0);
    }

    // Get busy intervals for this day
    const dayBusy = sortedBusy.filter(b => 
      b.start < dayEnd && b.end > dayStart
    );

    // Add lunch as a busy interval if specified
    if (lunchStartTime && lunchEndTime) {
      dayBusy.push({ start: lunchStartTime, end: lunchEndTime });
      dayBusy.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    // Find free slots
    let slotStart = dayStart;

    for (const busy of dayBusy) {
      // If there's a gap before this busy period
      if (busy.start > slotStart) {
        const gapEnd = busy.start;
        
        // Check if gap is long enough for a meeting
        const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (1000 * 60);
        
        if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
          // Generate slots within this gap
          let currentSlotStart = new Date(slotStart);
          while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= gapEnd.getTime()) {
            if (currentSlotStart >= minimumNoticeTime) {
              const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
              slots.push({
                start: currentSlotStart.toISOString(),
                end: slotEnd.toISOString(),
              });
            }
            // Move to next potential slot (30 min increments)
            currentSlotStart = new Date(currentSlotStart.getTime() + 30 * 60 * 1000);
          }
        }
      }
      
      // Move slot start to end of busy period
      if (busy.end > slotStart) {
        slotStart = busy.end;
      }
    }

    // Check for remaining time at end of day
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

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Limit to reasonable number of slots
  return slots.slice(0, 20);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const body: AvailabilityRequest = await req.json();
    const { participantUserIds, roomResourceEmail, startDate, endDate, durationMinutes, preferences } = body;

    console.log("Checking availability for:", { participantUserIds, roomResourceEmail, startDate, endDate });

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get calendar connections for all participants
    const { data: connections, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("provider", "google")
      .in("user_id", participantUserIds);

    if (connError) {
      console.error("Failed to fetch connections:", connError);
      throw connError;
    }

    const allBusyIntervals: BusyInterval[] = [];
    let participantsChecked = 0;

    // Check each participant's calendar
    for (const connection of connections || []) {
      // Check if token is expired or expiring soon - if so, refresh instead of skipping
      const tokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

      if (tokenExpiresAt && tokenExpiresAt < fiveMinutesFromNow) {
        if (connection.refresh_token) {
          console.log(`Token expired/expiring for user ${connection.user_id}, refreshing...`);
          const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
          if (refreshResult) {
            connection.access_token = refreshResult.access_token;
          } else {
            console.error(`Failed to refresh token for user ${connection.user_id}`);
            continue;
          }
        } else {
          console.log(`Token expired for user ${connection.user_id} and no refresh token, skipping`);
          continue;
        }
      }

      try {
        // Use selected_calendar_ids if available, otherwise fall back to ["primary"]
        const calendarIds = connection.selected_calendar_ids?.length
          ? connection.selected_calendar_ids
          : ["primary"];
        
        console.log(`Checking calendars for user ${connection.user_id}:`, calendarIds);

        const { busy } = await getBusyIntervalsWithRetry(
          connection,
          calendarIds,
          startDate,
          endDate,
          supabase
        );
        allBusyIntervals.push(...busy);
        participantsChecked++;
      } catch (err) {
        console.error(`Failed to get busy for user ${connection.user_id}:`, err);
      }
    }

    // Check room availability if in-person meeting
    if (roomResourceEmail) {
      // Find a connection with calendar access to check the room
      const adminConnection = connections?.[0];
      if (adminConnection) {
        try {
          console.log(`Checking room availability: ${roomResourceEmail}`);
          const { busy } = await getBusyIntervalsWithRetry(
            adminConnection,
            [roomResourceEmail],
            startDate,
            endDate,
            supabase
          );
          allBusyIntervals.push(...busy);
        } catch (err) {
          console.error("Failed to check room availability:", err);
        }
      }
    }

    // Generate available slots
    const slots = suggestSlots(
      allBusyIntervals,
      new Date(startDate),
      new Date(endDate),
      durationMinutes,
      preferences
    );

    console.log(`Found ${slots.length} available slots, checked ${participantsChecked} participants`);

    return new Response(JSON.stringify({ 
      slots,
      busyIntervals: allBusyIntervals,
      participantsChecked
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in check-availability:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});