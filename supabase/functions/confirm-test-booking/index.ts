import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConfirmTestBookingRequest {
  meetingId: string;
  startDatetime: string;
  endDatetime: string;
  runId: string;
}

interface IntegrationError {
  system: "lawmatics" | "google";
  status?: number;
  message: string;
  responseExcerpt?: string;
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

// Helper to write progress log
async function writeLog(
  supabase: any,
  meetingId: string,
  runId: string,
  step: string,
  level: string,
  message: string,
  details: Record<string, any> = {}
) {
  await supabase.from("booking_progress_logs").insert({
    meeting_id: meetingId,
    run_id: runId,
    step,
    level,
    message,
    details_json: details,
  });
}

// ========== LAWMATICS HELPERS ==========

// Get current Lawmatics user (the one connected to the system)
async function lawmaticsGetMe(accessToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const response = await fetch("https://api.lawmatics.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      console.error("[Lawmatics] users/me failed:", response.status);
      return null;
    }
    
    const data = await response.json();
    // Support JSON:API style (data.id/data.attributes.email) or flat style
    const id = data.data?.id || data.id || null;
    const email = data.data?.attributes?.email || data.email || data.data?.email || null;
    
    if (!id) {
      console.error("[Lawmatics] users/me: no id found in response", JSON.stringify(data).slice(0, 300));
      return null;
    }
    
    return { id: String(id), email: email || "" };
  } catch (err) {
    console.error("[Lawmatics] users/me exception:", err);
    return null;
  }
}

// Find or create a Lawmatics contact for an attendee email
async function lawmaticsFindOrCreateContact(
  accessToken: string,
  attendeeEmail: string,
  attendeeName?: string
): Promise<string | null> {
  console.log("[Lawmatics] Finding or creating contact for:", attendeeEmail);
  
  // Step 1: Try find_by_email endpoint
  try {
    const findByEmailUrl = `https://api.lawmatics.com/v1/contacts/find_by_email?email=${encodeURIComponent(attendeeEmail)}`;
    const findResp = await fetch(findByEmailUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    
    if (findResp.ok) {
      const findData = await findResp.json();
      const contactId = findData.data?.id || findData.id;
      if (contactId) {
        console.log("[Lawmatics] Found contact via find_by_email:", contactId);
        return String(contactId);
      }
    } else if (findResp.status !== 404 && findResp.status !== 405) {
      console.log("[Lawmatics] find_by_email returned:", findResp.status);
    }
  } catch (err) {
    console.log("[Lawmatics] find_by_email exception:", err);
  }
  
  // Step 2: Fallback to search endpoint
  try {
    const searchUrl = `https://api.lawmatics.com/v1/contacts?search=${encodeURIComponent(attendeeEmail)}&per_page=1`;
    const searchResp = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    
    if (searchResp.ok) {
      const searchData = await searchResp.json();
      const contacts = searchData.data || searchData.contacts || [];
      if (contacts.length > 0) {
        const contactId = contacts[0].id;
        console.log("[Lawmatics] Found contact via search:", contactId);
        return String(contactId);
      }
    }
  } catch (err) {
    console.log("[Lawmatics] search exception:", err);
  }
  
  // Step 3: Create a new contact
  try {
    const nameParts = (attendeeName || "Test Booking").split(" ");
    const firstName = nameParts[0] || "Test";
    const lastName = nameParts.slice(1).join(" ") || "Booking";
    
    const createPayload = {
      first_name: firstName,
      last_name: lastName,
      email: attendeeEmail,
    };
    
    console.log("[Lawmatics] Creating contact:", JSON.stringify(createPayload));
    
    const createResp = await fetch("https://api.lawmatics.com/v1/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createPayload),
    });
    
    if (createResp.ok) {
      const createData = await createResp.json();
      const contactId = createData.data?.id || createData.id;
      console.log("[Lawmatics] Created contact:", contactId);
      return contactId ? String(contactId) : null;
    } else {
      const errText = await createResp.text();
      console.error("[Lawmatics] Create contact failed:", createResp.status, errText.slice(0, 300));
    }
  } catch (err) {
    console.error("[Lawmatics] Create contact exception:", err);
  }
  
  return null;
}

// Read back a Lawmatics event to verify its properties
async function lawmaticsReadbackEvent(
  accessToken: string,
  eventId: string
): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(`https://api.lawmatics.com/v1/events/${eventId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      console.error("[Lawmatics] readback failed:", response.status);
      return null;
    }
    
    const data = await response.json();
    
    // Support JSON:API style (data.attributes.*) or flat style
    const attrs = data.data?.attributes || data;
    const id = data.data?.id || data.id || eventId;
    
    return {
      id: String(id),
      user_id: attrs.user_id || null,
      contact_id: attrs.contact_id || null,
      starts_at: attrs.starts_at || null,
      ends_at: attrs.ends_at || null,
      start_date: attrs.start_date || null,
      start_time: attrs.start_time || null,
      end_date: attrs.end_date || null,
      end_time: attrs.end_time || null,
      name: attrs.name || null,
      event_type_id: attrs.event_type_id || null,
      location_id: attrs.location_id || null,
    };
  } catch (err) {
    console.error("[Lawmatics] readback exception:", err);
    return null;
  }
}

// Helper to refresh Google token
async function refreshAccessToken(
  connectionId: string,
  refreshToken: string,
  supabase: any
): Promise<string | null> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
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
      return null;
    }

    const tokens = await tokenResponse.json();
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabase
      .from("calendar_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return tokens.access_token;
  } catch {
    return null;
  }
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
  locationId?: string | null,
  lawmaticsUserId?: string | null,
  lawmaticsContactId?: string | null,
  supabase?: any,
  meetingId?: string,
  runId?: string
): Promise<{ success: boolean; appointmentId?: string | null; error?: IntegrationError }> {
  
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
  if (lawmaticsUserId) payloadAttempt1.user_id = lawmaticsUserId;
  if (lawmaticsContactId) payloadAttempt1.contact_id = lawmaticsContactId;
  
  await writeLog(supabase, meetingId!, runId!, "lawmatics_request_attempt_1", "info", "Attempting Lawmatics create with starts_at/ends_at", {
    fields: Object.keys(payloadAttempt1),
    starts_at: startDatetime,
    ends_at: endDatetime,
    user_id: lawmaticsUserId,
    contact_id: lawmaticsContactId,
  });
  
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
      
      await writeLog(supabase, meetingId!, runId!, "lawmatics_success", "success", "Lawmatics event created (attempt 1)", {
        appointmentId,
        status: response1.status,
      });
      
      return { success: true, appointmentId };
    }
    
    // Check if we should retry with date/time format
    const shouldRetry = response1.status === 422 && 
      (responseText1.includes("start_date") || responseText1.includes("start_time"));
    
    if (!shouldRetry) {
      await writeLog(supabase, meetingId!, runId!, "lawmatics_error", "error", "Lawmatics API error (attempt 1)", {
        status: response1.status,
        error: responseText1.slice(0, 300),
      });
      
      return {
        success: false,
        error: {
          system: "lawmatics",
          status: response1.status,
          message: `Lawmatics API error: ${response1.status}`,
          responseExcerpt: responseText1.slice(0, 300),
        },
      };
    }
    
    // Attempt 2: Use start_date/start_time/end_date/end_time
    await writeLog(supabase, meetingId!, runId!, "lawmatics_request_attempt_2", "info", "Retrying with start_date/start_time format", {
      start_date: startParts.date,
      start_time: startParts.time,
      end_date: endParts.date,
      end_time: endParts.time,
      timezone,
      user_id: lawmaticsUserId,
      contact_id: lawmaticsContactId,
    });
    
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
    if (lawmaticsUserId) payloadAttempt2.user_id = lawmaticsUserId;
    if (lawmaticsContactId) payloadAttempt2.contact_id = lawmaticsContactId;
    
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
      
      await writeLog(supabase, meetingId!, runId!, "lawmatics_success", "success", "Lawmatics event created (attempt 2)", {
        appointmentId,
        status: response2.status,
      });
      
      return { success: true, appointmentId };
    }
    
    await writeLog(supabase, meetingId!, runId!, "lawmatics_error", "error", "Lawmatics API error (attempt 2)", {
      status: response2.status,
      error: responseText2.slice(0, 300),
    });
    
    return {
      success: false,
      error: {
        system: "lawmatics",
        status: response2.status,
        message: `Lawmatics API error after retry: ${response2.status}`,
        responseExcerpt: responseText2.slice(0, 300),
      },
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await writeLog(supabase, meetingId!, runId!, "lawmatics_error", "error", "Lawmatics request failed", { error: errorMessage });
    
    return {
      success: false,
      error: {
        system: "lawmatics",
        message: `Lawmatics request failed: ${errorMessage}`,
      },
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const errors: IntegrationError[] = [];

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body: ConfirmTestBookingRequest = await req.json();
    const { meetingId, startDatetime, endDatetime, runId } = body;

    if (!meetingId || !startDatetime || !endDatetime || !runId) {
      return new Response(JSON.stringify({ success: false, error: { message: "Missing required fields" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await writeLog(supabase, meetingId, runId, "start", "info", "Starting test booking confirmation...");

    // Fetch meeting with all relations
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        *,
        meeting_types (name, lawmatics_event_type_id),
        rooms (name, resource_email, lawmatics_location_id)
      `)
      .eq("id", meetingId)
      .single();

    if (meetingError || !meeting) {
      await writeLog(supabase, meetingId, runId, "error", "error", "Meeting not found", { error: meetingError?.message });
      return new Response(JSON.stringify({ success: false, error: { message: "Meeting not found" } }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preferences = meeting.preferences as Record<string, any> || {};
    const isTest = preferences.is_test === true;
    const adminCalendarId = preferences.admin_calendar_id;
    const sendInvites = preferences.send_invites === true;
    const timezone = meeting.timezone || "America/New_York";

    if (!isTest) {
      await writeLog(supabase, meetingId, runId, "error", "error", "Not a test booking");
      return new Response(JSON.stringify({ success: false, error: { message: "Not a test booking" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch host attorney
    let hostAttorney = null;
    if (meeting.host_attorney_user_id) {
      const { data: attorney } = await supabase
        .from("users")
        .select("id, name, email")
        .eq("id", meeting.host_attorney_user_id)
        .single();
      hostAttorney = attorney;
    }

    await writeLog(supabase, meetingId, runId, "meeting_update", "info", "Updating meeting status to Booked...");

    // Update meeting status
    const { error: updateMeetingError } = await supabase
      .from("meetings")
      .update({
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        status: "Booked",
        updated_at: new Date().toISOString(),
      })
      .eq("id", meetingId);

    if (updateMeetingError) {
      await writeLog(supabase, meetingId, runId, "meeting_update", "error", "Failed to update meeting", { error: updateMeetingError.message });
      throw new Error("Failed to update meeting");
    }

    await writeLog(supabase, meetingId, runId, "meeting_update", "success", "Meeting status updated to Booked");

    // Update booking request
    if (meeting.booking_request_id) {
      await supabase
        .from("booking_requests")
        .update({ status: "Completed" })
        .eq("id", meeting.booking_request_id);
    }

    // Create Lawmatics appointment
    let lawmaticsAppointmentId: string | null = null;
    let lawmaticsReadback: Record<string, any> | null = null;

    await writeLog(supabase, meetingId, runId, "lawmatics_start", "info", "Checking Lawmatics connection...");

    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lawmaticsConnection?.access_token) {
      const lawmaticsAccessToken = lawmaticsConnection.access_token;
      const client = meeting.external_attendees?.[0] as { name?: string; email?: string } | undefined;
      
      // Step 1: Get Lawmatics user_id (the connected user who will own the appointment)
      await writeLog(supabase, meetingId, runId, "lawmatics_me_start", "info", "Fetching Lawmatics user (users/me)...");
      const meResult = await lawmaticsGetMe(lawmaticsAccessToken);
      let lawmaticsUserId: string | null = null;
      
      if (meResult) {
        lawmaticsUserId = meResult.id;
        await writeLog(supabase, meetingId, runId, "lawmatics_me_fetched", "success", "Lawmatics user fetched", {
          lawmatics_user_id: lawmaticsUserId,
          lawmatics_user_email: meResult.email,
        });
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_me_failed", "warn", "Could not fetch Lawmatics user - appointment may not be assigned");
      }
      
      // Step 2: Find or create contact for the attendee
      const attendeeEmail = client?.email || hostAttorney?.email || "";
      const attendeeName = client?.name || "";
      let lawmaticsContactId: string | null = null;
      
      if (attendeeEmail) {
        await writeLog(supabase, meetingId, runId, "lawmatics_contact_start", "info", "Finding/creating Lawmatics contact...", {
          attendee_email: attendeeEmail,
          attendee_name: attendeeName,
        });
        
        lawmaticsContactId = await lawmaticsFindOrCreateContact(lawmaticsAccessToken, attendeeEmail, attendeeName);
        
        if (lawmaticsContactId) {
          await writeLog(supabase, meetingId, runId, "lawmatics_contact_resolved", "success", "Lawmatics contact resolved", {
            contact_id: lawmaticsContactId,
            attendee_email: attendeeEmail,
          });
        } else {
          await writeLog(supabase, meetingId, runId, "lawmatics_contact_failed", "warn", "Could not find/create Lawmatics contact - appointment may not be linked to contact");
        }
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_contact_skip", "warn", "No attendee email - skipping contact lookup");
      }
      
      // Step 3: Create the event with user_id and contact_id
      const eventName = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;

      const descriptionParts = [
        "⚠️ TEST BOOKING - Created from Admin Test My Booking",
        "",
        `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
        `Duration: ${meeting.duration_minutes} minutes`,
        `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
        hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
      ].filter(Boolean).join("\n");

      const lawmaticsResult = await createLawmaticsEvent(
        lawmaticsAccessToken,
        eventName,
        descriptionParts,
        startDatetime,
        endDatetime,
        timezone,
        meeting.meeting_types?.lawmatics_event_type_id,
        meeting.location_mode === "InPerson" ? meeting.rooms?.lawmatics_location_id : null,
        lawmaticsUserId,
        lawmaticsContactId,
        supabase,
        meetingId,
        runId
      );

      if (lawmaticsResult.success) {
        lawmaticsAppointmentId = lawmaticsResult.appointmentId || null;
        
        // Step 4: Readback the created event to verify it's linked correctly
        if (lawmaticsAppointmentId) {
          await writeLog(supabase, meetingId, runId, "lawmatics_readback_start", "info", "Reading back Lawmatics event...");
          lawmaticsReadback = await lawmaticsReadbackEvent(lawmaticsAccessToken, lawmaticsAppointmentId);
          
          if (lawmaticsReadback) {
            await writeLog(supabase, meetingId, runId, "lawmatics_readback", "success", "Lawmatics event readback complete", lawmaticsReadback);
          } else {
            await writeLog(supabase, meetingId, runId, "lawmatics_readback_failed", "warn", "Could not read back Lawmatics event");
          }
        }
      } else if (lawmaticsResult.error) {
        errors.push(lawmaticsResult.error);
      }
    } else {
      await writeLog(supabase, meetingId, runId, "lawmatics_skip", "warn", "No Lawmatics connection configured");
    }

    // Store Lawmatics ID if created
    if (lawmaticsAppointmentId) {
      await supabase
        .from("meetings")
        .update({ lawmatics_appointment_id: lawmaticsAppointmentId })
        .eq("id", meetingId);
    }

    // Create Google Calendar event
    await writeLog(supabase, meetingId, runId, "google_start", "info", "Creating Google Calendar event...");

    const { data: calendarConnection } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", meeting.host_attorney_user_id)
      .eq("provider", "google")
      .maybeSingle();

    let googleEventId: string | null = null;

    if (calendarConnection && adminCalendarId) {
      try {
        let accessToken = calendarConnection.access_token;

        // Refresh token if needed
        const tokenExpiresAt = calendarConnection.token_expires_at ? new Date(calendarConnection.token_expires_at) : null;
        if (tokenExpiresAt && tokenExpiresAt < new Date() && calendarConnection.refresh_token) {
          const refreshed = await refreshAccessToken(calendarConnection.id, calendarConnection.refresh_token, supabase);
          if (refreshed) accessToken = refreshed;
        }

        const client = meeting.external_attendees?.[0];
        const eventSummary = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Test"} - ${hostAttorney?.name || "Attorney"}`;

        const attendees: { email: string; resource?: boolean }[] = [];
        if (hostAttorney?.email) attendees.push({ email: hostAttorney.email });
        if (client?.email) attendees.push({ email: client.email });
        if (meeting.rooms?.resource_email) attendees.push({ email: meeting.rooms.resource_email, resource: true });

        const eventBody = {
          summary: eventSummary,
          description: `⚠️ TEST BOOKING - Created from Admin Test My Booking\n\nMeeting Type: ${meeting.meeting_types?.name || "Meeting"}\nRoom: ${meeting.rooms?.name || "N/A"}`,
          start: { dateTime: startDatetime, timeZone: timezone },
          end: { dateTime: endDatetime, timeZone: timezone },
          attendees,
        };

        const sendUpdatesParam = sendInvites ? "all" : "none";
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(adminCalendarId)}/events?sendUpdates=${sendUpdatesParam}`;

        await writeLog(supabase, meetingId, runId, "google_request", "info", `Posting to calendar: ${adminCalendarId}`, {
          sendUpdates: sendUpdatesParam,
          attendeeCount: attendees.length,
        });

        const calendarResponse = await fetch(calendarUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        });

        if (calendarResponse.ok) {
          const eventData = await calendarResponse.json();
          googleEventId = eventData.id;
          await writeLog(supabase, meetingId, runId, "google_success", "success", "Google Calendar event created", {
            eventId: googleEventId,
            calendarId: adminCalendarId,
            htmlLink: eventData.htmlLink,
          });
        } else {
          const errorText = await calendarResponse.text();
          errors.push({
            system: "google",
            status: calendarResponse.status,
            message: `Google Calendar API error: ${calendarResponse.status}`,
            responseExcerpt: errorText.slice(0, 500),
          });
          await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar API error", {
            status: calendarResponse.status,
            error: errorText.slice(0, 500),
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        errors.push({
          system: "google",
          message: `Google Calendar request failed: ${errorMessage}`,
        });
        await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar request failed", { error: errorMessage });
      }
    } else {
      await writeLog(supabase, meetingId, runId, "google_skip", "warn", "No Google calendar connection or calendar ID");
    }

    // Update meeting with Google event ID
    if (googleEventId) {
      await supabase
        .from("meetings")
        .update({
          preferences: {
            ...preferences,
            google_event_id: googleEventId,
          },
        })
        .eq("id", meetingId);
    }

    // Log completion
    const hasErrors = errors.length > 0;
    await writeLog(
      supabase,
      meetingId,
      runId,
      "done",
      hasErrors ? "warn" : "success",
      hasErrors ? "Test booking completed with some errors" : "Test booking completed successfully",
      {
        lawmaticsAppointmentId,
        googleEventId,
        errors,
      }
    );

    // Create audit log
    await supabase.from("audit_logs").insert({
      action_type: "Booked",
      meeting_id: meetingId,
      details_json: {
        is_test: true,
        booked_at: new Date().toISOString(),
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        lawmatics_appointment_id: lawmaticsAppointmentId,
        google_event_id: googleEventId,
        admin_calendar_id: adminCalendarId,
        errors: hasErrors ? errors : undefined,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        ok: true,
        meetingId,
        lawmaticsAppointmentId,
        lawmaticsReadback,
        googleEventId,
        hasErrors,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in confirm-test-booking:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        ok: false,
        error: { message: error instanceof Error ? error.message : "Unknown error" } 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
