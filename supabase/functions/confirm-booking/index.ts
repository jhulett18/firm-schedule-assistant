import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createOrRepairLawmaticsAppointment,
  resolveLawmaticsUserIdByEmail,
  lawmaticsFindOrCreateContact,
  lawmaticsCreateMatter,
  lawmaticsUpdateEvent,
  lawmaticsDeleteEvent,
  lawmaticsReadEvent,
  pickString,
  pickNumber,
} from "../_shared/lawmatics.ts";

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
  created_by_user_id: string | null;
  google_calendar_id: string | null;
  participant_user_ids: string[];
  meeting_type_id: string | null;
  room_id: string | null;
  booking_request_id: string | null;
  lawmatics_appointment_id: string | null;
  lawmatics_contact_id: string | null;
  lawmatics_matter_id: string | null;
  meeting_types?: { name: string; lawmatics_event_type_id: string | null } | null;
  rooms?: { name: string; resource_email: string; lawmatics_location_id: string | null } | null;
  host_attorney?: { name: string; email: string } | null;
}

interface GoogleEventResult {
  user_id: string;
  user_email?: string;
  calendar_id?: string;
  event_id?: string;
  created?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

interface LawmaticsAppointmentResult {
  appointment_id?: string | null;
  created?: boolean;
  updated?: boolean;
  skipped?: boolean;
  reason?: string;
  assigned_user_ids?: number[];
  error?: string;
}

// Helper to convert ISO datetime to date/time parts in a given timezone
function toLocalDateTimeParts(
  isoDatetime: string,
  timezone: string
): { date: string; time: string; timeSeconds: string } {
  const d = new Date(isoDatetime);

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const year = dateParts.find((p) => p.type === "year")?.value || "";
  const month = dateParts.find((p) => p.type === "month")?.value || "";
  const day = dateParts.find((p) => p.type === "day")?.value || "";
  const dateStr = `${year}-${month}-${day}`.slice(0, 10);

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hour = timeParts.find((p) => p.type === "hour")?.value || "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value || "00";
  const time = `${hour}:${minute}`;
  const timeSeconds = `${hour}:${minute}:00`;

  return { date: dateStr, time, timeSeconds };
}

// Helper to write progress log (non-blocking)
async function writeLog(
  supabase: any,
  meetingId: string,
  runId: string,
  step: string,
  level: string,
  message: string,
  details: Record<string, any> = {}
) {
  try {
    const { error } = await supabase.from("booking_progress_logs").insert({
      meeting_id: meetingId,
      run_id: runId,
      step,
      level,
      message,
      details_json: details,
    });

    if (error) {
      console.error("booking_progress_logs insert failed", {
        meeting_id: meetingId,
        run_id: runId,
        step,
        level,
        message,
        error,
      });
    }
  } catch (e) {
    console.error("writeLog exception (non-blocking):", e);
  }
}

// Helper to refresh Google OAuth token if expired
async function refreshGoogleTokenIfNeeded(
  supabase: any,
  calendarConnection: any
): Promise<{ accessToken: string | null; error?: string }> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { accessToken: null, error: "Google OAuth not configured" };
  }

  let accessToken = calendarConnection.access_token;

  // Check if token is expired
  if (calendarConnection.token_expires_at && new Date(calendarConnection.token_expires_at) < new Date()) {
    if (!calendarConnection.refresh_token) {
      return { accessToken: null, error: "Token expired and no refresh token available" };
    }

    try {
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
        return { accessToken: null, error: "Failed to refresh Google token" };
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      // Update stored token (non-blocking)
      await supabase
        .from("calendar_connections")
        .update({
          access_token: tokens.access_token,
          token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", calendarConnection.id);
    } catch (e) {
      console.error("Token refresh error:", e);
      return { accessToken: null, error: "Token refresh failed" };
    }
  }

  return { accessToken };
}

// Create Google Calendar event for a SINGLE user on their own calendar
async function createGoogleCalendarEventForUser(
  supabase: any,
  meeting: MeetingDetails,
  userId: string,
  userEmail: string,
  allParticipantEmails: string[],
  hostAttorney: { name: string; email: string } | null,
  startDatetime: string,
  endDatetime: string
): Promise<GoogleEventResult> {
  try {
    // Get this user's Google calendar connection
    const { data: calendarConnection } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("provider", "google")
      .eq("user_id", userId)
      .maybeSingle();

    if (!calendarConnection) {
      return { 
        user_id: userId, 
        user_email: userEmail,
        error: "No Google calendar connection for this user",
        created: false 
      };
    }

    // Refresh token if needed
    const { accessToken, error: tokenError } = await refreshGoogleTokenIfNeeded(supabase, calendarConnection);
    if (!accessToken) {
      return { 
        user_id: userId, 
        user_email: userEmail,
        error: tokenError || "Failed to get access token",
        created: false 
      };
    }

    // Determine target calendar
    let targetCalendarId = "primary";
    if (calendarConnection.selected_calendar_ids?.length > 0) {
      targetCalendarId = calendarConnection.selected_calendar_ids[0];
    }

    // Build attendees list
    const attendees: { email: string; resource?: boolean }[] = [];
    
    // Add ALL internal participants as attendees
    for (const email of allParticipantEmails) {
      if (email) {
        attendees.push({ email });
      }
    }

    // Add external attendees (client)
    for (const ext of meeting.external_attendees || []) {
      if (ext.email) {
        attendees.push({ email: ext.email });
      }
    }

    // Add room as a resource attendee ONLY if InPerson and room has resource_email
    if (meeting.location_mode === "InPerson" && meeting.rooms?.resource_email) {
      attendees.push({ email: meeting.rooms.resource_email, resource: true });
    }

    const client = meeting.external_attendees?.[0];
    const eventSummary = `${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;

    // Build description
    const descriptionParts = [
      `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
      `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
    ];
    if (meeting.location_mode === "InPerson" && meeting.rooms?.name) {
      descriptionParts.push(`Room: ${meeting.rooms.name}`);
    }
    if (allParticipantEmails.length > 1) {
      descriptionParts.push(`Participants: ${allParticipantEmails.join(", ")}`);
    }

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
      description: descriptionParts.join("\n"),
    };

    console.log(`Creating Google Calendar event for user ${userId} on calendar: ${targetCalendarId}`);

    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?sendUpdates=all`,
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
      console.error(`Google Calendar API error for user ${userId}:`, errorText);
      return { 
        user_id: userId, 
        user_email: userEmail,
        calendar_id: targetCalendarId,
        error: `Google Calendar API error: ${calendarResponse.status}`,
        created: false 
      };
    }

    const eventData = await calendarResponse.json();
    console.log(`Google Calendar event created for user ${userId}:`, eventData.id);
    
    return { 
      user_id: userId, 
      user_email: userEmail,
      calendar_id: targetCalendarId,
      event_id: eventData.id,
      created: true 
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`Google Calendar exception for user ${userId}:`, errMsg);
    return {
      user_id: userId,
      user_email: userEmail,
      error: errMsg,
      created: false
    };
  }
}

// Create Google Calendar events for ALL participants with idempotency
async function createGoogleCalendarEventsForAllParticipants(
  supabase: any,
  meeting: MeetingDetails,
  participants: Array<{ id: string; email: string }>,
  hostAttorney: { name: string; email: string } | null,
  startDatetime: string,
  endDatetime: string
): Promise<{ results: GoogleEventResult[]; warnings: string[] }> {
  const results: GoogleEventResult[] = [];
  const warnings: string[] = [];
  const allParticipantEmails = participants.map(p => p.email).filter(Boolean);

  try {
    // Check for existing events for this meeting (idempotency)
    const { data: existingEvents } = await supabase
      .from("meeting_google_events")
      .select("user_id, google_calendar_id, google_event_id")
      .eq("meeting_id", meeting.id);

    const existingByUser = new Map<string, { calendar_id: string; event_id: string }>();
    for (const ev of existingEvents || []) {
      existingByUser.set(ev.user_id, { 
        calendar_id: ev.google_calendar_id, 
        event_id: ev.google_event_id 
      });
    }

    for (const participant of participants) {
      // Check idempotency - skip if event already exists for this user
      const existing = existingByUser.get(participant.id);
      if (existing) {
        console.log(`Google event already exists for user ${participant.id}, skipping`);
        results.push({
          user_id: participant.id,
          user_email: participant.email,
          calendar_id: existing.calendar_id,
          event_id: existing.event_id,
          skipped: true,
          reason: "Google event already exists for this meeting"
        });
        continue;
      }

      // Create event for this participant
      const result = await createGoogleCalendarEventForUser(
        supabase,
        meeting,
        participant.id,
        participant.email,
        allParticipantEmails,
        hostAttorney,
        startDatetime,
        endDatetime
      );

      results.push(result);

      if (result.created && result.event_id) {
        // Persist to meeting_google_events table (non-blocking)
        try {
          await supabase
            .from("meeting_google_events")
            .insert({
              meeting_id: meeting.id,
              user_id: participant.id,
              google_calendar_id: result.calendar_id,
              google_event_id: result.event_id,
            });
        } catch (insertErr) {
          console.error(`Failed to persist Google event for user ${participant.id}:`, insertErr);
        }
      } else if (result.error) {
        warnings.push(`Google Calendar for ${participant.email}: ${result.error}`);
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("createGoogleCalendarEventsForAllParticipants error:", errMsg);
    warnings.push(`Google Calendar batch error: ${errMsg}`);
  }

  return { results, warnings };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Response structure - always return valid JSON
  const response: {
    success: boolean;
    meetingId?: string;
    error?: string;
    warnings?: string[];
    lawmatics_debug?: any;
    lawmatics?: any;
    google?: any;
    phase1_completed?: boolean;
    phase2_completed?: boolean;
  } = {
    success: false,
    warnings: [],
  };

  try {
    // Parse request body
    let body: ConfirmBookingRequest;
    try {
      body = await req.json();
    } catch (parseErr) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Invalid JSON in request body" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token, startDatetime, endDatetime } = body;

    if (!token || !startDatetime || !endDatetime) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Missing required fields: token, startDatetime, endDatetime" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Confirming booking for token:", token);

    // ==========================================
    // PHASE 1: Critical booking operations (MUST succeed)
    // ==========================================

    // 1. Fetch booking request by token
    const { data: bookingRequest, error: brError } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();

    if (brError || !bookingRequest) {
      console.error("Booking request not found:", brError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Booking link not found" 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate status
    if (bookingRequest.status !== "Open") {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "This booking has already been completed" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiration
    if (new Date(bookingRequest.expires_at) < new Date()) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "This booking link has expired" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch meeting details with relations
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
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Meeting not found" 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    response.meetingId = meeting.id;
    const timezone = meeting.timezone || "America/New_York";

    // Store original values for reschedule detection (used in Phase 2)
    const originalMeetingStatus = meeting.status as string;
    const oldLawmaticsAppointmentId = meeting.lawmatics_appointment_id as string | null;
    const isReschedule = originalMeetingStatus === "Rescheduled";

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
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Failed to reserve time slot" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Update booking request status to Completed
    const { error: updateBrError } = await supabase
      .from("booking_requests")
      .update({ status: "Completed" })
      .eq("id", bookingRequest.id);

    if (updateBrError) {
      console.error("Failed to update booking request:", updateBrError);
      response.warnings!.push("Failed to update booking request status");
    }

    // PHASE 1 COMPLETE - Booking is now reserved
    response.success = true;
    response.phase1_completed = true;
    console.log("Phase 1 complete - booking reserved for meeting:", meeting.id);

    // ==========================================
    // PHASE 2: Non-blocking integrations (best-effort)
    // ==========================================
    
    // Initialize debug structures - enhanced for matter bisect debugging
    const lawmatics_debug: {
      contact: { attempted: boolean; endpoint: string; status: number; id?: string; body_excerpt?: string };
      matter: { 
        attempted: boolean; 
        endpoint: string; 
        status: number; 
        id?: string; 
        body_excerpt?: string;
        field_that_caused_error?: string;
      };
      matter_attempts: Array<{
        endpoint: string;
        method: string;
        status: number;
        body_excerpt: string;
        payload_sent?: Record<string, any>;
        fields_included?: string[];
      }>;
      event: { attempted: boolean; endpoint: string; status: number; id?: string; body_excerpt?: string };
      matter_to_event_link?: { 
        attempted: boolean; 
        event_id: string; 
        matter_id: string; 
        status: number; 
        ok: boolean; 
        excerpt: string; 
      };
      timestamp?: string;
    } = {
      contact: { attempted: false, endpoint: "", status: 0 },
      matter: { attempted: false, endpoint: "", status: 0 },
      matter_attempts: [],
      event: { attempted: false, endpoint: "", status: 0 },
      timestamp: new Date().toISOString(),
    };

    let googleResults: GoogleEventResult[] = [];
    let googleWarnings: string[] = [];
    let lawmaticsAppointmentId: string | null = null;
    let lawmaticsContactId: string | null = null;
    let lawmaticsMatterId: string | null = null;
    let lawmaticsContactError: string | null = null;

    try {
      // Fetch room_reservation_mode setting
      const { data: roomReservationSetting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "room_reservation_mode")
        .maybeSingle();
      
      const roomReservationMode = roomReservationSetting?.value || "LawmaticsSync";

      // Fetch host attorney details
      let hostAttorney: { name: string; email: string } | null = null;
      if (meeting.host_attorney_user_id) {
        const { data: attorney } = await supabase
          .from("users")
          .select("name, email")
          .eq("id", meeting.host_attorney_user_id)
          .single();
        hostAttorney = attorney;
      }

      // Build complete list of participants
      const allParticipantIds = new Set<string>();
      if (meeting.host_attorney_user_id) {
        allParticipantIds.add(meeting.host_attorney_user_id);
      }
      for (const pid of meeting.participant_user_ids || []) {
        allParticipantIds.add(pid);
      }

      // Fetch participant details
      const participantIdsArray = Array.from(allParticipantIds);
      let participants: Array<{ id: string; email: string; name: string }> = [];
      
      if (participantIdsArray.length > 0) {
        const { data: participantData } = await supabase
          .from("users")
          .select("id, email, name")
          .in("id", participantIdsArray);
        
        participants = (participantData || []).map(p => ({ 
          id: p.id, 
          email: p.email, 
          name: p.name 
        }));
      }

      const participantEmails = participants.map(p => p.email).filter(Boolean);
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // === LAWMATICS INTEGRATION (wrapped in try/catch) ===
      try {
        const { data: lawmaticsConnection } = await supabase
          .from("lawmatics_connections")
          .select("access_token")
          .order("connected_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lawmaticsConnection?.access_token) {
          const accessToken = lawmaticsConnection.access_token;

          // === RESCHEDULE CLEANUP: Delete old Lawmatics appointment if this is a reschedule ===
          if (isReschedule && oldLawmaticsAppointmentId) {
            console.log(`[confirm-booking] Reschedule detected - deleting old Lawmatics appointment: ${oldLawmaticsAppointmentId}`);
            try {
              // Step 1: Attempt DELETE
              const deleteResult = await lawmaticsDeleteEvent(accessToken, oldLawmaticsAppointmentId);
              console.log(`[confirm-booking] Lawmatics DELETE result for ${oldLawmaticsAppointmentId}:`, deleteResult);

              // Step 2: Verify deletion by attempting to read the event
              const stillExists = await lawmaticsReadEvent(accessToken, oldLawmaticsAppointmentId);
              
              if (!stillExists) {
                // Event is gone - deletion confirmed
                console.log(`[confirm-booking] Lawmatics event ${oldLawmaticsAppointmentId} deletion verified (not found)`);
              } else {
                // Step 3: Event still exists - Lawmatics likely soft-deleted or DELETE failed
                console.log(`[confirm-booking] Lawmatics event ${oldLawmaticsAppointmentId} still exists after DELETE, applying fallback cleanup`);
                
                const existingName = typeof stillExists?.name === "string" ? stillExists.name : null;
                let cleanedName: string;
                if (existingName) {
                  const stripped = existingName.replace(/^(Cancelled|Rescheduled)\s*-\s*/i, "").trim();
                  cleanedName = `[DELETED] Rescheduled - ${stripped}`;
                } else {
                  cleanedName = "[DELETED] Rescheduled appointment";
                }

                const fallbackPayload: Record<string, unknown> = {
                  status: "cancelled",
                  name: cleanedName,
                };

                const fallbackUpdate = await lawmaticsUpdateEvent(accessToken, oldLawmaticsAppointmentId, "PATCH", fallbackPayload);
                
                if (fallbackUpdate.ok) {
                  response.warnings!.push("Previous Lawmatics appointment was marked as cancelled/rescheduled (soft-delete).");
                } else {
                  // Try minimal fallback - just the name
                  const minimalUpdate = await lawmaticsUpdateEvent(accessToken, oldLawmaticsAppointmentId, "PATCH", { name: cleanedName });
                  if (minimalUpdate.ok) {
                    response.warnings!.push("Previous Lawmatics appointment was renamed to indicate removal.");
                  } else {
                    response.warnings!.push(`Failed to cleanup old Lawmatics appointment ${oldLawmaticsAppointmentId}.`);
                  }
                }
              }

              // Clear the old appointment ID from the meeting so we create a fresh one
              await supabase
                .from("meetings")
                .update({ lawmatics_appointment_id: null })
                .eq("id", meeting.id);
            } catch (deleteErr) {
              const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
              console.error(`[confirm-booking] Lawmatics delete error (non-blocking):`, errMsg);
              response.warnings!.push(`Failed to delete old Lawmatics appointment: ${errMsg}`);
            }
          }
          // === END RESCHEDULE CLEANUP ===

          const client = meeting.external_attendees?.[0];
          const clientEmail = pickString(client?.email);
          const clientName = pickString(client?.name) || "Client";

          // Get admin's matter attachment choice
          const matterMode = bookingRequest.lawmatics_matter_mode || "new";
          const existingMatterId = bookingRequest.lawmatics_existing_matter_id;

          // --- Lawmatics Contact (resolve early for appointment + matter) ---
          // For reschedules, we cleared the old appointment, so we need a contact for the new one
          const effectiveHasAppointment = isReschedule ? false : !!meeting.lawmatics_appointment_id;
          const shouldResolveContact =
            !!clientEmail &&
            (!effectiveHasAppointment ||
              (!meeting.lawmatics_matter_id && matterMode !== "existing"));

          if (shouldResolveContact) {
            try {
              lawmaticsContactId = meeting.lawmatics_contact_id;

              if (!lawmaticsContactId) {
                const tokens = clientName.split(/\s+/).filter(Boolean);
                const clientFirstName = tokens[0] || "Client";
                const clientLastName = tokens.slice(1).join(" ") || "Booking";

                const contactResult = await lawmaticsFindOrCreateContact(accessToken, {
                  email: clientEmail,
                  name: clientName,
                  first_name: clientFirstName,
                  last_name: clientLastName,
                });

                const lastContactAttempt = contactResult.attempts[contactResult.attempts.length - 1];
                lawmatics_debug.contact = {
                  attempted: true,
                  endpoint: lastContactAttempt?.endpoint || "/v1/contacts",
                  status: lastContactAttempt?.status ?? 0,
                  id: contactResult.contactIdStr || undefined,
                  body_excerpt: lastContactAttempt?.body_excerpt || contactResult.error || undefined,
                };

                if (contactResult.contactIdStr) {
                  lawmaticsContactId = contactResult.contactIdStr;
                  await supabase
                    .from("meetings")
                    .update({ lawmatics_contact_id: lawmaticsContactId })
                    .eq("id", meeting.id);
                } else if (contactResult.error) {
                  lawmaticsContactError = contactResult.error;
                  response.warnings!.push(`[lawmatics_contact] ${contactResult.error}`);
                }
              } else {
                lawmatics_debug.contact = {
                  attempted: false,
                  endpoint: "/v1/contacts",
                  status: 0,
                  id: lawmaticsContactId,
                  body_excerpt: "skipped (already exists)",
                };
              }
            } catch (contactErr) {
              const errMsg = contactErr instanceof Error ? contactErr.message : String(contactErr);
              console.error("Lawmatics contact error (non-blocking):", errMsg);
              lawmaticsContactError = errMsg;
              response.warnings!.push(`[lawmatics_contact] ${errMsg}`);
            }
          }

          // --- Lawmatics Matter (create BEFORE event so we can link event to matter) ---
          if (!meeting.lawmatics_matter_id && matterMode !== "existing" && clientEmail) {
            try {
              if (!lawmaticsContactId) {
                if (lawmaticsContactError) {
                  response.warnings!.push(`[lawmatics_contact] ${lawmaticsContactError}`);
                }
                lawmatics_debug.matter = {
                  attempted: false,
                  endpoint: "/v1/prospects",
                  status: 0,
                  id: undefined,
                  body_excerpt: "skipped (missing contact)",
                };
              } else {
                const tokens = clientName.split(/\s+/).filter(Boolean);
                const clientFirstName = tokens[0] || "Client";
                const clientLastName = tokens.slice(1).join(" ") || "Booking";

                // Create Matter
                const meetingTypeName = meeting.meeting_types?.name || "Meeting";
                const matterTitle = `${clientLastName}, ${clientFirstName} - ${meetingTypeName}`;
                const startParts = toLocalDateTimeParts(startDatetime, timezone);
                const matterDescription = [
                  `Meeting Type: ${meetingTypeName}`,
                  `Scheduled: ${startParts.date} ${startParts.time} (${timezone})`,
                  `Duration: ${meeting.duration_minutes} minutes`,
                  `Booking Request ID: ${bookingRequest.id}`,
                  `Meeting ID: ${meeting.id}`,
                ].join("\n");

                const matterResult = await lawmaticsCreateMatter(accessToken, {
                  contactId: lawmaticsContactId,
                  email: clientEmail,
                  firstName: clientFirstName,
                  lastName: clientLastName,
                  caseTitle: matterTitle,
                  notes: matterDescription,
                });

                // Store all attempts for debugging
                lawmatics_debug.matter_attempts = (matterResult.attempts || []).map(a => ({
                  endpoint: a.endpoint,
                  method: a.method,
                  status: a.status,
                  body_excerpt: a.body_excerpt,
                  payload_sent: a.payload_sent,
                  fields_included: a.fields_included,
                }));

                const lastMatterAttempt = (matterResult.attempts || [])[(matterResult.attempts || []).length - 1];
                lawmatics_debug.matter = {
                  attempted: true,
                  endpoint: matterResult.endpointUsed || lastMatterAttempt?.endpoint || "",
                  status: lastMatterAttempt?.status ?? 0,
                  id: matterResult.matterIdStr || undefined,
                  body_excerpt: lastMatterAttempt?.body_excerpt || (matterResult.warnings?.join("; ") || undefined),
                  field_that_caused_error: matterResult.fieldThatCausedError,
                };

                if (matterResult.matterIdStr) {
                  lawmaticsMatterId = matterResult.matterIdStr;
                  await supabase
                    .from("meetings")
                    .update({ lawmatics_matter_id: lawmaticsMatterId })
                    .eq("id", meeting.id);
                } else if (matterResult.warnings?.length) {
                  response.warnings!.push(`[lawmatics_matter] ${matterResult.warnings.join("; ")}`);
                }
              }
            } catch (matterErr) {
              const errMsg = matterErr instanceof Error ? matterErr.message : String(matterErr);
              console.error("Lawmatics matter error (non-blocking):", errMsg);
              response.warnings!.push(`[lawmatics_matter] ${errMsg}`);
            }
          } else if (matterMode === "existing" && existingMatterId) {
            lawmaticsMatterId = existingMatterId;
            await supabase
              .from("meetings")
              .update({ lawmatics_matter_id: existingMatterId })
              .eq("id", meeting.id);
            lawmatics_debug.matter = {
              attempted: false,
              endpoint: "",
              status: 0,
              id: existingMatterId,
              body_excerpt: "skipped (admin selected existing matter)",
            };
          } else if (meeting.lawmatics_matter_id) {
            lawmaticsMatterId = meeting.lawmatics_matter_id;
            lawmatics_debug.matter = {
              attempted: false,
              endpoint: "",
              status: 0,
              id: meeting.lawmatics_matter_id,
              body_excerpt: "skipped (already exists)",
            };
          }

          // --- Lawmatics Event/Appointment (created AFTER matter so we can link to it) ---
          // For reschedules, we already deleted the old appointment, so create a new one
          if (!effectiveHasAppointment) {
            try {
              await writeLog(supabase, meeting.id, runId, "lawmatics_resolve_user_start", "info", "Resolving Lawmatics owner", {});

              const host = await resolveLawmaticsUserIdByEmail(accessToken, hostAttorney?.email || null);
              const effectiveTimezone = host.timezone || meeting.timezone || "America/New_York";

              // Resolve all participant Lawmatics user IDs
              const resolvedParticipantLawmaticsIds: number[] = [];
              for (const participant of participants) {
                const resolved = await resolveLawmaticsUserIdByEmail(accessToken, participant.email);
                if (resolved.userId) {
                  resolvedParticipantLawmaticsIds.push(resolved.userId);
                }
              }

              const eventName = `${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;
              const descriptionParts = [
                `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
                `Duration: ${meeting.duration_minutes} minutes`,
                `Location: ${meeting.location_mode === "InPerson" ? meeting.rooms?.name || "In Person" : "Zoom"}`,
                hostAttorney ? `Host Attorney: ${hostAttorney.name}` : null,
                client?.email ? `Client Email: ${client.email}` : null,
              ].filter(Boolean).join("\n");

              // Pass matterId to link event to matter from creation
              const appointment = await createOrRepairLawmaticsAppointment(
                accessToken,
                {
                  name: eventName,
                  description: descriptionParts,
                  startDatetime,
                  endDatetime,
                  timezone: effectiveTimezone,
                  eventTypeId: pickNumber(meeting.meeting_types?.lawmatics_event_type_id),
                  locationId: meeting.location_mode === "InPerson" ? pickNumber(meeting.rooms?.lawmatics_location_id) : null,
                  userId: host.userId,
                  contactId: lawmaticsContactId ? parseInt(lawmaticsContactId, 10) : null,
                  matterId: lawmaticsMatterId ? parseInt(lawmaticsMatterId, 10) : null,
                  requiresLocation: meeting.location_mode === "InPerson",
                },
                async (step, level, message, details) => {
                  await writeLog(supabase, meeting.id, runId, step, level, message, details || {});
                }
              );

              // Populate debug info
              const lastAttempt = (appointment.attempts || [])[(appointment.attempts || []).length - 1];
              lawmatics_debug.event = {
                attempted: true,
                endpoint: lastAttempt?.endpoint || "/v1/events",
                status: lastAttempt?.status || 0,
                id: appointment.createdId || undefined,
                body_excerpt: lastAttempt?.body_excerpt || appointment.error || undefined,
              };
              // Track matter linkage separately in debug
              (lawmatics_debug as any).event_linked_to_matter = lawmaticsMatterId || null;

              if (appointment.createdId) {
                lawmaticsAppointmentId = appointment.createdId;
                await supabase
                  .from("meetings")
                  .update({ lawmatics_appointment_id: lawmaticsAppointmentId })
                  .eq("id", meeting.id);
              } else if (appointment.error) {
                response.warnings!.push(`[lawmatics_event] ${appointment.error}`);
              }
            } catch (eventErr) {
              const errMsg = eventErr instanceof Error ? eventErr.message : String(eventErr);
              console.error("Lawmatics event error (non-blocking):", errMsg);
              response.warnings!.push(`[lawmatics_event] ${errMsg}`);
              lawmatics_debug.event = { attempted: true, endpoint: "/v1/events", status: 0, body_excerpt: errMsg };
            }
          } else {
            lawmaticsAppointmentId = meeting.lawmatics_appointment_id;
            lawmatics_debug.event = {
              attempted: false,
              endpoint: "/v1/events",
              status: 0,
              id: lawmaticsAppointmentId || undefined,
              body_excerpt: "skipped (already exists)",
            };
          }
        }
      } catch (lawmaticsErr) {
        const errMsg = lawmaticsErr instanceof Error ? lawmaticsErr.message : String(lawmaticsErr);
        console.error("Lawmatics integration error (non-blocking):", errMsg);
        response.warnings!.push(`[lawmatics] ${errMsg}`);
      }

      // === GOOGLE CALENDAR INTEGRATION (wrapped in try/catch) ===
      try {
        if (participants.length > 0) {
          console.log("Creating Google Calendar events for participants");
          const googleResponse = await createGoogleCalendarEventsForAllParticipants(
            supabase,
            meeting as unknown as MeetingDetails,
            participants,
            hostAttorney,
            startDatetime,
            endDatetime
          );
          googleResults = googleResponse.results;
          googleWarnings = googleResponse.warnings;
          
          for (const gw of googleWarnings) {
            response.warnings!.push(`[google] ${gw}`);
          }
        }
      } catch (googleErr) {
        const errMsg = googleErr instanceof Error ? googleErr.message : String(googleErr);
        console.error("Google Calendar integration error (non-blocking):", errMsg);
        response.warnings!.push(`[google] ${errMsg}`);
      }

      // === PERSIST DEBUG INFO (non-blocking) ===
      try {
        await supabase
          .from("meetings")
          .update({
            lawmatics_debug: {
              lawmatics: lawmatics_debug,
              updated_at: new Date().toISOString(),
            },
          })
          .eq("id", meeting.id);
      } catch (debugPersistErr) {
        console.warn("Failed to persist lawmatics_debug (non-blocking):", debugPersistErr);
        response.warnings!.push("Failed to persist debug info");
      }

      // === AUDIT LOG (non-blocking) ===
      try {
        await supabase.from("audit_logs").insert({
          action_type: "Booked",
          meeting_id: meeting.id,
          details_json: {
            booked_at: new Date().toISOString(),
            start_datetime: startDatetime,
            end_datetime: endDatetime,
            lawmatics_appointment_id: lawmaticsAppointmentId,
            lawmatics_contact_id: lawmaticsContactId,
            lawmatics_matter_id: lawmaticsMatterId,
            google_events_created: googleResults.filter((r) => r.created).length,
            google_events_skipped: googleResults.filter((r) => r.skipped).length,
            participant_count: participants.length,
          },
        });
      } catch (auditErr) {
        console.warn("Failed to write audit log (non-blocking):", auditErr);
      }

      response.phase2_completed = true;
    } catch (phase2Err) {
      // Phase 2 failed entirely but booking is still successful
      const errMsg = phase2Err instanceof Error ? phase2Err.message : String(phase2Err);
      console.error("Phase 2 error (non-blocking):", errMsg);
      response.warnings!.push(`Phase 2 integration error: ${errMsg}`);
      response.phase2_completed = false;
    }

    // Add integration info to response
    response.lawmatics_debug = lawmatics_debug;
    response.lawmatics = {
      appointment_id: lawmaticsAppointmentId,
      contact_id: lawmaticsContactId,
      matter_id: lawmaticsMatterId,
    };
    response.google = {
      results: googleResults,
      summary: {
        total: googleResults.length,
        created: googleResults.filter((r) => r.created).length,
        skipped: googleResults.filter((r) => r.skipped).length,
        failed: googleResults.filter((r) => r.error && !r.skipped).length,
      },
    };

    // Clean up empty warnings array
    if (response.warnings?.length === 0) {
      delete response.warnings;
    }

    console.log("Booking confirmed successfully for meeting:", meeting.id);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    // Outer catch - should only trigger for Phase 1 errors
    console.error("Critical error in confirm-booking:", error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      phase1_completed: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
