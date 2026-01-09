import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConfirmBookingRequest {
  token: string;
  startDatetime: string;
  endDatetime: string;
}

interface MeetingDetails {
  id: string;
  duration_minutes: number;
  location_mode: string;
  in_person_location_choice: string | null;
  external_attendees: { name?: string; email?: string; phone?: string }[];
  timezone: string;
  host_attorney_user_id: string | null;
  meeting_type_id: string | null;
  room_id: string | null;
  booking_request_id: string | null;
  meeting_types?: { name: string; lawmatics_event_type_id: string | null } | null;
  rooms?: { name: string; resource_email: string; lawmatics_location_id: string | null } | null;
  host_attorney?: { name: string; email: string } | null;
}

// Helper to convert ISO datetime to date/time parts in a given timezone
function toLocalDateTimeParts(isoDatetime: string, timezone: string): { date: string; time: string } {
  const date = new Date(isoDatetime);
  
  // Get date in YYYY-MM-DD format using en-CA locale (gives ISO format reliably)
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  
  const year = dateParts.find(p => p.type === 'year')?.value || '';
  const month = dateParts.find(p => p.type === 'month')?.value || '';
  const day = dateParts.find(p => p.type === 'day')?.value || '';
  const dateStr = `${year}-${month}-${day}`;
  
  // Get time in HH:mm format using en-GB locale with 24h format
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  
  const hour = timeParts.find(p => p.type === 'hour')?.value || '00';
  const minute = timeParts.find(p => p.type === 'minute')?.value || '00';
  const timeStr = `${hour}:${minute}`;
  
  return { date: dateStr, time: timeStr };
}

// Helper to create Lawmatics event with retry logic
async function createLawmaticsEvent(
  accessToken: string,
  eventName: string,
  description: string,
  startDatetime: string,
  endDatetime: string,
  timezone: string,
  eventTypeId?: string | null,
  locationId?: string | null
): Promise<{ success: boolean; appointmentId?: string | null; error?: string }> {
  
  // Calculate date/time parts for fallback
  const startParts = toLocalDateTimeParts(startDatetime, timezone);
  const endParts = toLocalDateTimeParts(endDatetime, timezone);
  
  // Attempt 1: Use starts_at/ends_at (ISO format)
  const payloadAttempt1: Record<string, any> = {
    name: eventName,
    starts_at: startDatetime,
    ends_at: endDatetime,
    description,
  };
  
  if (eventTypeId) payloadAttempt1.event_type_id = eventTypeId;
  if (locationId) payloadAttempt1.location_id = locationId;
  
  console.log("[Lawmatics] Attempt 1 payload:", JSON.stringify(payloadAttempt1));
  
  try {
    const response1 = await fetch("https://api.lawmatics.com/v1/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadAttempt1),
    });
    
    const responseText1 = await response1.text();
    console.log("[Lawmatics] Attempt 1 response:", response1.status, responseText1.slice(0, 500));
    
    if (response1.ok) {
      let responseData;
      try {
        responseData = JSON.parse(responseText1);
      } catch {
        responseData = {};
      }
      const appointmentId = responseData.data?.id || responseData.id || null;
      console.log("[Lawmatics] Event created successfully (attempt 1), ID:", appointmentId);
      return { success: true, appointmentId };
    }
    
    // Check if we should retry with date/time format
    const shouldRetry = response1.status === 422 && 
      (responseText1.includes("start_date") || responseText1.includes("start_time"));
    
    if (!shouldRetry) {
      console.error("[Lawmatics] API error (attempt 1):", response1.status, responseText1.slice(0, 500));
      return {
        success: false,
        error: `Lawmatics API error: ${response1.status} - ${responseText1.slice(0, 200)}`,
      };
    }
    
    // Attempt 2: Use start_date/start_time/end_date/end_time
    console.log("[Lawmatics] Retrying with start_date/start_time format");
    
    const payloadAttempt2: Record<string, any> = {
      name: eventName,
      description,
      start_date: startParts.date,
      start_time: startParts.time,
      end_date: endParts.date,
      end_time: endParts.time,
    };
    
    if (eventTypeId) payloadAttempt2.event_type_id = eventTypeId;
    if (locationId) payloadAttempt2.location_id = locationId;
    
    console.log("[Lawmatics] Attempt 2 payload:", JSON.stringify(payloadAttempt2));
    
    const response2 = await fetch("https://api.lawmatics.com/v1/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadAttempt2),
    });
    
    const responseText2 = await response2.text();
    console.log("[Lawmatics] Attempt 2 response:", response2.status, responseText2.slice(0, 500));
    
    if (response2.ok) {
      let responseData;
      try {
        responseData = JSON.parse(responseText2);
      } catch {
        responseData = {};
      }
      const appointmentId = responseData.data?.id || responseData.id || null;
      console.log("[Lawmatics] Event created successfully (attempt 2), ID:", appointmentId);
      return { success: true, appointmentId };
    }
    
    console.error("[Lawmatics] API error (attempt 2):", response2.status, responseText2.slice(0, 500));
    return {
      success: false,
      error: `Lawmatics API error after retry: ${response2.status} - ${responseText2.slice(0, 200)}`,
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Lawmatics] Request failed:", errorMessage);
    return {
      success: false,
      error: `Lawmatics request failed: ${errorMessage}`,
    };
  }
}

// Helper to create/update Google Calendar event with room resource
async function createGoogleCalendarEventWithRoom(
  supabase: any,
  meeting: MeetingDetails,
  hostAttorney: { name: string; email: string } | null,
  startDatetime: string,
  endDatetime: string
): Promise<{ success: boolean; error?: string }> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { success: false, error: "Google OAuth not configured" };
  }

  if (!meeting.host_attorney_user_id) {
    return { success: false, error: "No host attorney assigned" };
  }

  // Get Google calendar connection for the host attorney
  const { data: calendarConnection } = await supabase
    .from("calendar_connections")
    .select("*")
    .eq("provider", "google")
    .eq("user_id", meeting.host_attorney_user_id)
    .maybeSingle();

  if (!calendarConnection) {
    return { success: false, error: "No Google calendar connection for host attorney" };
  }

  let accessToken = calendarConnection.access_token;

  // Refresh token if expired
  if (calendarConnection.token_expires_at && new Date(calendarConnection.token_expires_at) < new Date()) {
    if (!calendarConnection.refresh_token) {
      return { success: false, error: "Token expired and no refresh token available" };
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: calendarConnection.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      return { success: false, error: "Failed to refresh Google token" };
    }

    const tokens = await tokenResponse.json();
    accessToken = tokens.access_token;

    // Update stored token
    await supabase
      .from("calendar_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", calendarConnection.id);
  }

  // Build attendees list including room resource
  const attendees: { email: string; resource?: boolean }[] = [];
  
  if (hostAttorney?.email) {
    attendees.push({ email: hostAttorney.email });
  }

  // Add external attendees
  for (const ext of meeting.external_attendees || []) {
    if (ext.email) {
      attendees.push({ email: ext.email });
    }
  }

  // Add room as a resource attendee
  if (meeting.rooms?.resource_email) {
    attendees.push({ email: meeting.rooms.resource_email, resource: true });
  }

  const client = meeting.external_attendees?.[0];
  const eventSummary = `${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;

  const eventBody = {
    summary: eventSummary,
    start: {
      dateTime: startDatetime,
      timeZone: meeting.timezone,
    },
    end: {
      dateTime: endDatetime,
      timeZone: meeting.timezone,
    },
    attendees,
    description: `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}\nRoom: ${meeting.rooms?.name || "N/A"}`,
  };

  console.log("Creating Google Calendar event with room:", JSON.stringify(eventBody));

  const calendarResponse = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    }
  );

  if (!calendarResponse.ok) {
    const errorText = await calendarResponse.text();
    console.error("Google Calendar API error:", errorText);
    return { success: false, error: `Google Calendar API error: ${calendarResponse.status}` };
  }

  const eventData = await calendarResponse.json();
  console.log("Google Calendar event created:", eventData.id);
  return { success: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: ConfirmBookingRequest = await req.json();
    const { token, startDatetime, endDatetime } = body;

    console.log("Confirming booking for token:", token);

    // 1. Fetch booking request by token
    const { data: bookingRequest, error: brError } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();

    if (brError || !bookingRequest) {
      console.error("Booking request not found:", brError);
      return new Response(JSON.stringify({ error: "Booking link not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate status
    if (bookingRequest.status !== "Open") {
      return new Response(JSON.stringify({ error: "This booking has already been completed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiration
    if (new Date(bookingRequest.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "This booking link has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch meeting details with relations (including lawmatics mapping fields)
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        *,
        meeting_types (name, lawmatics_event_type_id),
        rooms (name, resource_email, lawmatics_location_id)
      `)
      .eq("id", bookingRequest.meeting_id)
      .single();

    if (meetingError || !meeting) {
      console.error("Meeting not found:", meetingError);
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const timezone = meeting.timezone || "America/New_York";

    // Fetch room_reservation_mode setting
    const { data: roomReservationSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "room_reservation_mode")
      .maybeSingle();
    
    const roomReservationMode = roomReservationSetting?.value || "LawmaticsSync";

    // Fetch host attorney details
    let hostAttorney = null;
    if (meeting.host_attorney_user_id) {
      const { data: attorney } = await supabase
        .from("users")
        .select("name, email")
        .eq("id", meeting.host_attorney_user_id)
        .single();
      hostAttorney = attorney;
    }

    // 3. Update meeting with selected slot and set status to Booked
    const { error: updateMeetingError } = await supabase
      .from("meetings")
      .update({
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        status: "Booked",
        updated_at: new Date().toISOString(),
      })
      .eq("id", meeting.id);

    if (updateMeetingError) {
      console.error("Failed to update meeting:", updateMeetingError);
      throw new Error("Failed to update meeting");
    }

    // 4. Update booking request status to Completed
    const { error: updateBrError } = await supabase
      .from("booking_requests")
      .update({ status: "Completed" })
      .eq("id", bookingRequest.id);

    if (updateBrError) {
      console.error("Failed to update booking request:", updateBrError);
      // Non-fatal, continue
    }

    // 5. Create appointment in Lawmatics via direct API with retry logic
    let lawmaticsAppointmentId: string | null = null;
    let lawmaticsError: string | null = null;

    // Fetch Lawmatics connection
    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lawmaticsConnection?.access_token) {
      const client = meeting.external_attendees?.[0];
      const eventName = `${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;
      
      // Build description with fallback info if mappings not set
      const descriptionParts = [
        `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
        `Duration: ${meeting.duration_minutes} minutes`,
        `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || meeting.in_person_location_choice || "In Person") : "Zoom"}`,
        hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
        client?.name ? `Client: ${client.name}` : null,
        client?.email ? `Client Email: ${client.email}` : null,
        client?.phone ? `Client Phone: ${client.phone}` : null,
      ].filter(Boolean).join("\n");

      const lawmaticsResult = await createLawmaticsEvent(
        lawmaticsConnection.access_token,
        eventName,
        descriptionParts,
        startDatetime,
        endDatetime,
        timezone,
        meeting.meeting_types?.lawmatics_event_type_id,
        meeting.location_mode === "InPerson" ? meeting.rooms?.lawmatics_location_id : null
      );

      if (lawmaticsResult.success) {
        lawmaticsAppointmentId = lawmaticsResult.appointmentId || null;
        console.log("Lawmatics event created, ID:", lawmaticsAppointmentId);
      } else {
        lawmaticsError = lawmaticsResult.error || "Unknown Lawmatics error";
        console.error("Lawmatics error:", lawmaticsError);
      }
    } else {
      console.log("No Lawmatics connection configured, skipping external integration");
    }

    // 6. Handle Lawmatics result
    if (lawmaticsError && lawmaticsConnection) {
      // Only fail if we had a connection but the API call failed
      // Set meeting status to Failed
      await supabase
        .from("meetings")
        .update({ status: "Failed", updated_at: new Date().toISOString() })
        .eq("id", meeting.id);

      // Log audit record
      await supabase.from("audit_logs").insert({
        action_type: "Failed",
        meeting_id: meeting.id,
        details_json: {
          error: lawmaticsError,
          attempted_at: new Date().toISOString(),
          start_datetime: startDatetime,
          end_datetime: endDatetime,
        },
      });

      return new Response(JSON.stringify({ 
        success: false,
        error: "We were unable to complete your booking. Please contact us directly to schedule your meeting.",
        meetingId: meeting.id,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Store Lawmatics appointment ID if returned
    if (lawmaticsAppointmentId) {
      await supabase
        .from("meetings")
        .update({ 
          lawmatics_appointment_id: lawmaticsAppointmentId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", meeting.id);
    }

    // 8. If DirectCalendar mode and room is assigned, create calendar event with room
    let calendarRoomReservationResult: { success: boolean; error?: string } | null = null;
    if (roomReservationMode === "DirectCalendar" && meeting.room_id && meeting.rooms?.resource_email) {
      console.log("DirectCalendar mode enabled, creating calendar event with room resource");
      calendarRoomReservationResult = await createGoogleCalendarEventWithRoom(
        supabase,
        meeting as unknown as MeetingDetails,
        hostAttorney,
        startDatetime,
        endDatetime
      );
      
      if (!calendarRoomReservationResult.success) {
        console.warn("Room calendar reservation failed (non-fatal):", calendarRoomReservationResult.error);
      } else {
        console.log("Room calendar reservation successful");
      }
    }

    // 9. Log success audit
    await supabase.from("audit_logs").insert({
      action_type: "Booked",
      meeting_id: meeting.id,
      details_json: {
        booked_at: new Date().toISOString(),
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        lawmatics_appointment_id: lawmaticsAppointmentId,
        lawmatics_event_type_id: meeting.meeting_types?.lawmatics_event_type_id || null,
        lawmatics_location_id: meeting.rooms?.lawmatics_location_id || null,
        room_reservation_mode: roomReservationMode,
        room_calendar_reserved: calendarRoomReservationResult?.success ?? null,
      },
    });

    console.log("Booking confirmed successfully for meeting:", meeting.id);

    return new Response(JSON.stringify({ 
      success: true,
      meetingId: meeting.id,
      lawmaticsAppointmentId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in confirm-booking:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
