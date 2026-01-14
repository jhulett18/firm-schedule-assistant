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

// Generate slots from busy intervals
// Helper to create a Date object representing a specific local time in a timezone
function createDateInTimezone(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  // Create a date string that will be parsed differently in different locales
  // We'll use this to find the offset
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  // Parse as UTC first
  const utc = new Date(dateStr + 'Z');

  // Get the formatter for the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Format the UTC time to see what it looks like in the target timezone
  const parts = formatter.formatToParts(utc);
  const partsObj: Record<string, string> = {};
  parts.forEach(p => { if (p.type !== 'literal') partsObj[p.type] = p.value; });

  // Calculate what we got vs what we wanted
  const gotYear = parseInt(partsObj.year);
  const gotMonth = parseInt(partsObj.month);
  const gotDay = parseInt(partsObj.day);
  const gotHour = parseInt(partsObj.hour);
  const gotMinute = parseInt(partsObj.minute);

  // Calculate the hour difference (the main offset component)
  let hourDiff = hour - gotHour;
  let dayDiff = day - gotDay;

  // Handle day boundary crossings
  if (dayDiff !== 0) {
    hourDiff += dayDiff * 24;
  }

  // Apply the offset
  return new Date(utc.getTime() + hourDiff * 60 * 60 * 1000 + (minute - gotMinute) * 60 * 1000);
}

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

    // Parse business hours for this day (in client timezone)
    const [startHour, startMin] = businessHoursStart.split(":").map(Number);
    const [endHour, endMin] = businessHoursEnd.split(":").map(Number);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();

    const dayStart = createDateInTimezone(year, month, day, startHour, startMin, clientTimezone);
    const dayEnd = createDateInTimezone(year, month, day, endHour, endMin, clientTimezone);

    // Parse lunch block (in client timezone)
    const [lunchStartHour, lunchStartMin] = lunchStart.split(":").map(Number);
    const [lunchEndHour, lunchEndMin] = lunchEnd.split(":").map(Number);
    const lunchStartTime = createDateInTimezone(year, month, day, lunchStartHour, lunchStartMin, clientTimezone);
    const lunchEndTime = createDateInTimezone(year, month, day, lunchEndHour, lunchEndMin, clientTimezone);

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

    // 2. Fetch meeting details - now including participant_user_ids
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        id,
        duration_minutes,
        host_attorney_user_id,
        room_id,
        location_mode,
        support_user_ids,
        participant_user_ids,
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

    // 4. Build list of ALL participant user IDs
    // Priority: use participant_user_ids if populated, else fallback to legacy host + support_user_ids
    let participantUserIds: string[] = [];
    
    if (meeting.participant_user_ids && Array.isArray(meeting.participant_user_ids) && meeting.participant_user_ids.length > 0) {
      // Use new participant_user_ids field (includes host + additional participants)
      participantUserIds = meeting.participant_user_ids;
      console.log("Using participant_user_ids:", participantUserIds);
    } else {
      // Fallback to legacy fields for backward compatibility
      if (meeting.host_attorney_user_id) {
        participantUserIds.push(meeting.host_attorney_user_id);
      }
      if (meeting.support_user_ids && Array.isArray(meeting.support_user_ids)) {
        participantUserIds.push(...meeting.support_user_ids);
      }
      console.log("Using legacy host + support_user_ids:", participantUserIds);
    }

    // 5. Get calendar connections for ALL participants
    const { data: connections } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("provider", "google")
      .in("user_id", participantUserIds);

    console.log(`Found ${connections?.length || 0} calendar connections for ${participantUserIds.length} participants`);

    const allBusyIntervals: BusyInterval[] = [];
    const searchWindowDays = meeting.search_window_days_used || 14;
    const startDate = dateCursor ? new Date(dateCursor) : new Date();
    const endDate = new Date(startDate.getTime() + searchWindowDays * 24 * 60 * 60 * 1000);

    // 6. Fetch busy intervals for EACH participant (intersection availability)
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
        
        console.log(`Checking calendars for participant ${connection.user_id}:`, calendarIds);

        const { busy } = await getBusyIntervalsWithRetry(
          connection,
          calendarIds,
          startDate.toISOString(),
          endDate.toISOString(),
          supabase
        );
        
        // Add all busy intervals from this participant (intersection = all busy times matter)
        allBusyIntervals.push(...busy);
        console.log(`Added ${busy.length} busy intervals from participant ${connection.user_id}`);
      } catch (err) {
        console.error(`Failed to get busy for participant ${connection.user_id}:`, err);
      }
    }

    // 7. Check room availability if in-person meeting
    if (roomResourceEmail && connections && connections.length > 0) {
      const adminConnection = connections[0];
      try {
        console.log(`Checking room availability: ${roomResourceEmail}`);
        const { busy } = await getBusyIntervalsWithRetry(
          adminConnection,
          [roomResourceEmail],
          startDate.toISOString(),
          endDate.toISOString(),
          supabase
        );
        allBusyIntervals.push(...busy);
      } catch (err) {
        console.error("Failed to check room availability:", err);
      }
    }

    console.log(`Total busy intervals across all participants: ${allBusyIntervals.length}`);

    // 8. Generate available slots (intersection: free only when ALL are free)
    const slots = suggestSlots(
      allBusyIntervals,
      startDate,
      endDate,
      meeting.duration_minutes,
      clientTimezone
    );

    console.log(`Found ${slots.length} available slots that work for all participants`);

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
