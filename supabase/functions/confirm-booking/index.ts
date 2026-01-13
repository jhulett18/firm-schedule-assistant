import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createOrRepairLawmaticsAppointment,
  resolveLawmaticsUserIdByEmail,
  lawmaticsFindOrCreateContact,
  lawmaticsFindOrCreateMatter,
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
  meeting_types?: { name: string; lawmatics_event_type_id: string | null } | null;
  rooms?: { name: string; resource_email: string; lawmatics_location_id: string | null } | null;
  host_attorney?: { name: string; email: string } | null;
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

// Note: Using shared lawmatics helpers from _shared/lawmatics.ts
// pickNumber, lawmaticsFindOrCreateContact, lawmaticsFindOrCreateMatter

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
}


// Helper to create Google Calendar event with HOST as organizer and ALL participants as attendees
// Returns the created event ID for persistence
async function createGoogleCalendarEvent(
  supabase: any,
  meeting: MeetingDetails,
  hostAttorney: { name: string; email: string } | null,
  participantEmails: string[],
  startDatetime: string,
  endDatetime: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { success: false, error: "Google OAuth not configured" };
  }

  // Use host_attorney_user_id as the organizer for Google event
  if (!meeting.host_attorney_user_id) {
    return { success: false, error: "No host assigned to meeting" };
  }

  // Get Google calendar connection for the HOST (organizer)
  const { data: calendarConnection } = await supabase
    .from("calendar_connections")
    .select("*")
    .eq("provider", "google")
    .eq("user_id", meeting.host_attorney_user_id)
    .maybeSingle();

  if (!calendarConnection) {
    return { success: false, error: "No Google calendar connection for host user" };
  }

  // Use the host's primary or first selected calendar
  let targetCalendarId = "primary";
  if (calendarConnection.selected_calendar_ids?.length > 0) {
    targetCalendarId = calendarConnection.selected_calendar_ids[0];
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

  // Build attendees list
  const attendees: { email: string; resource?: boolean }[] = [];
  
  // Add ALL internal participants as attendees
  for (const email of participantEmails) {
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

  // Build description based on location mode
  const descriptionParts = [
    `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
    `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
  ];
  if (meeting.location_mode === "InPerson" && meeting.rooms?.name) {
    descriptionParts.push(`Room: ${meeting.rooms.name}`);
  }
  if (participantEmails.length > 1) {
    descriptionParts.push(`Participants: ${participantEmails.join(", ")}`);
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

  console.log(`Creating Google Calendar event on calendar: ${targetCalendarId}`, JSON.stringify(eventBody));

  // Use the host's calendar
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
    console.error("Google Calendar API error:", errorText);
    return { success: false, error: `Google Calendar API error: ${calendarResponse.status}` };
  }

  const eventData = await calendarResponse.json();
  console.log("Google Calendar event created:", eventData.id, "on calendar:", targetCalendarId);
  return { success: true, eventId: eventData.id };
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

    // 2. Fetch meeting details with relations (including participant_user_ids)
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

    // Fetch ALL participant emails for Google Calendar attendees
    const participantUserIds = meeting.participant_user_ids || [];
    let participantEmails: string[] = [];
    
    if (participantUserIds.length > 0) {
      const { data: participants } = await supabase
        .from("users")
        .select("email")
        .in("id", participantUserIds);
      
      participantEmails = (participants || []).map(p => p.email).filter(Boolean);
      console.log("Participant emails for Google Calendar:", participantEmails);
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

    // 5. Create appointment in Lawmatics with robust create/verify/repair
    let lawmaticsAppointmentId: string | null = null;
    let lawmaticsError: string | null = null;

    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lawmaticsConnection?.access_token) {
      const accessToken = lawmaticsConnection.access_token;
      const client = meeting.external_attendees?.[0];

      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await writeLog(supabase, meeting.id, runId, "lawmatics_resolve_user_start", "info", "Resolving Lawmatics owner user by email", {
        email: hostAttorney?.email || null,
      });

      const host = await resolveLawmaticsUserIdByEmail(accessToken, hostAttorney?.email || null);

      await writeLog(
        supabase,
        meeting.id,
        runId,
        host.userId ? "lawmatics_resolve_user_success" : "lawmatics_resolve_user_warn",
        host.userId ? "success" : "warn",
        host.userId ? "Resolved Lawmatics owner user" : "Could not resolve Lawmatics owner user by email",
        { lawmatics_user_id: host.userId, timezone: host.timezone }
      );

      const effectiveTimezone = host.timezone || meeting.timezone || "America/New_York";

      const eventName = `${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;
      const descriptionParts = [
        `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
        `Duration: ${meeting.duration_minutes} minutes`,
        `Location: ${meeting.location_mode === "InPerson" ? meeting.rooms?.name || "In Person" : "Zoom"}`,
        hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
        client?.name ? `Client: ${client.name}` : null,
        client?.email ? `Client Email: ${client.email}` : null,
      ]
        .filter(Boolean)
        .join("\n");

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
          contactId: null,
          requiresLocation: meeting.location_mode === "InPerson",
        },
        async (step, level, message, details) => {
          await writeLog(supabase, meeting.id, runId, step, level, message, details || {});
        }
      );

      if (appointment.createdId && appointment.persisted) {
        lawmaticsAppointmentId = appointment.createdId;
      } else {
        lawmaticsError = appointment.error || "Lawmatics appointment did not persist times/owner";
        await writeLog(supabase, meeting.id, runId, "lawmatics_final_status", "error", "Lawmatics appointment did not persist", {
          createdId: appointment.createdId,
          readback: appointment.readback,
          error: appointment.error,
        });
      }
    } else {
      console.log("No Lawmatics connection configured");
    }

    // 6. Handle Lawmatics result - DO NOT BLOCK CLIENT on Lawmatics failure
    // The meeting is already marked as Booked (step 3), so the client booking is complete.
    // Log a warning for staff to review, but let the client see success.
    if (lawmaticsError && lawmaticsConnection) {
      console.warn("Lawmatics sync failed (non-blocking):", lawmaticsError);
      
      // Log audit record for staff to review - but do NOT change meeting status to Failed
      await supabase.from("audit_logs").insert({
        action_type: "Failed",
        meeting_id: meeting.id,
        details_json: {
          warning: "Lawmatics sync failed but booking was completed successfully",
          lawmatics_error: lawmaticsError,
          attempted_at: new Date().toISOString(),
          start_datetime: startDatetime,
          end_datetime: endDatetime,
          note: "Staff should manually create appointment in Lawmatics if needed",
        },
      });
      // Continue to success response - do NOT return 500
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

    // 8. Create Lawmatics Contact and Matter (NON-BLOCKING)
    let lawmaticsContactId: string | null = null;
    let lawmaticsMatterId: string | null = null;
    let contactWarning: string | null = null;
    let matterWarning: string | null = null;

    if (lawmaticsConnection?.access_token) {
      const accessToken = lawmaticsConnection.access_token;
      const client = meeting.external_attendees?.[0];
      const clientEmail = pickString(client?.email);
      const clientName = pickString(client?.name) || "Client";
      const clientPhone = pickString(client?.phone);

      // Check idempotency - if matter already exists, skip
      if (meeting.lawmatics_matter_id) {
        console.log("Lawmatics matter already exists, skipping creation:", meeting.lawmatics_matter_id);
        lawmaticsMatterId = meeting.lawmatics_matter_id;
      } else if (clientEmail) {
        // A) Find or create Lawmatics contact
        const tokens = clientName.split(/\s+/).filter(Boolean);
        const contactResult = await lawmaticsFindOrCreateContact(accessToken, {
          email: clientEmail,
          name: clientName,
          first_name: tokens[0] || "Client",
          last_name: tokens.slice(1).join(" ") || "Booking",
        });

        if (contactResult.contactIdStr) {
          lawmaticsContactId = contactResult.contactIdStr;
          console.log("Lawmatics contact resolved:", lawmaticsContactId, contactResult.created ? "(created)" : "(existing)");
          
          // Persist contact ID immediately
          await supabase
            .from("meetings")
            .update({ 
              lawmatics_contact_id: lawmaticsContactId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", meeting.id);

          // B) Create Lawmatics Matter
          const clientLastName = tokens.slice(1).join(" ") || tokens[0] || "Client";
          const clientFirstName = tokens[0] || "Client";
          const meetingTypeName = meeting.meeting_types?.name || "Meeting";
          const matterTitle = `${clientLastName}, ${clientFirstName} - ${meetingTypeName}`;

          // Build description with booking details
          const startParts = toLocalDateTimeParts(startDatetime, timezone);
          const endParts = toLocalDateTimeParts(endDatetime, timezone);
          
          const matterDescParts = [
            `Meeting Type: ${meetingTypeName}`,
            `Scheduled: ${startParts.date} ${startParts.time} - ${endParts.time} (${timezone})`,
            `Duration: ${meeting.duration_minutes} minutes`,
            `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
          ];
          
          if (meeting.rooms?.name && meeting.location_mode === "InPerson") {
            matterDescParts.push(`Room: ${meeting.rooms.name}`);
          }
          
          if (hostAttorney) {
            matterDescParts.push(`Host Attorney: ${hostAttorney.name} (${hostAttorney.email})`);
          }
          
          if (participantEmails.length > 0) {
            matterDescParts.push(`Participants: ${participantEmails.join(", ")}`);
          }
          
          matterDescParts.push("");
          matterDescParts.push("--- Traceability ---");
          matterDescParts.push(`Booking Request ID: ${bookingRequest.id}`);
          matterDescParts.push(`Meeting ID: ${meeting.id}`);
          if (lawmaticsAppointmentId) {
            matterDescParts.push(`Lawmatics Appointment ID: ${lawmaticsAppointmentId}`);
          }
          // Google event ID will be added after creation

          const matterResult = await lawmaticsFindOrCreateMatter(
            accessToken,
            lawmaticsContactId,
            { email: clientEmail, name: clientName },
            matterTitle
          );

          if (matterResult.matterIdStr) {
            lawmaticsMatterId = matterResult.matterIdStr;
            console.log("Lawmatics matter resolved:", lawmaticsMatterId, matterResult.created ? "(created)" : "(existing)");
            
            // Persist matter ID
            await supabase
              .from("meetings")
              .update({ 
                lawmatics_matter_id: lawmaticsMatterId,
                updated_at: new Date().toISOString(),
              })
              .eq("id", meeting.id);
          } else {
            matterWarning = matterResult.error || "Failed to create Lawmatics matter";
            console.warn("Lawmatics matter creation failed (non-blocking):", matterWarning);
          }
        } else {
          contactWarning = contactResult.error || "Failed to create Lawmatics contact";
          console.warn("Lawmatics contact creation failed (non-blocking):", contactWarning);
        }
      } else {
        console.log("Skipping Lawmatics contact/matter - no client email");
      }
    }

    // 9. Create Google Calendar event with HOST as organizer and ALL participants as attendees
    let googleResult: { success: boolean; eventId?: string; error?: string } | null = null;
    let googleWarning: string | null = null;

    if (meeting.host_attorney_user_id) {
      console.log("Attempting Google Calendar event creation for host:", meeting.host_attorney_user_id, "with participants:", participantEmails);
      
      googleResult = await createGoogleCalendarEvent(
        supabase,
        meeting as unknown as MeetingDetails,
        hostAttorney,
        participantEmails,
        startDatetime,
        endDatetime
      );
      
      if (!googleResult.success) {
        console.warn("Google Calendar event creation failed (non-fatal):", googleResult.error);
        googleWarning = googleResult.error || "Unknown Google Calendar error";
      } else {
        console.log("Google Calendar event created successfully:", googleResult.eventId);
        
        // Persist google_event_id to meeting
        if (googleResult.eventId) {
          await supabase
            .from("meetings")
            .update({ 
              google_event_id: googleResult.eventId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", meeting.id);
        }
      }
    } else {
      console.log("Skipping Google Calendar event - no host_attorney_user_id on meeting");
    }

    // Build warnings array for response
    const warnings: { system: string; message: string }[] = [];
    if (lawmaticsError && lawmaticsConnection) {
      warnings.push({ system: "lawmatics_appointment", message: lawmaticsError });
    }
    if (contactWarning) {
      warnings.push({ system: "lawmatics_contact", message: contactWarning });
    }
    if (matterWarning) {
      warnings.push({ system: "lawmatics_matter", message: matterWarning });
    }
    if (googleWarning) {
      warnings.push({ system: "google", message: googleWarning });
    }

    // 10. Log success audit
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
        lawmatics_event_type_id: meeting.meeting_types?.lawmatics_event_type_id || null,
        lawmatics_location_id: meeting.rooms?.lawmatics_location_id || null,
        room_reservation_mode: roomReservationMode,
        google_event_id: googleResult?.eventId ?? null,
        google_calendar_success: googleResult?.success ?? null,
        google_calendar_error: googleWarning,
        participant_count: participantEmails.length,
      },
    });

    console.log("Booking confirmed successfully for meeting:", meeting.id);

    return new Response(JSON.stringify({ 
      success: true,
      meetingId: meeting.id,
      lawmaticsAppointmentId,
      lawmaticsContactId,
      lawmaticsMatterId,
      googleEventId: googleResult?.eventId ?? null,
      warnings: warnings.length > 0 ? warnings : undefined,
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
