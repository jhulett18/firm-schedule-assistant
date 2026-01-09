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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body: ConfirmTestBookingRequest = await req.json();
    const { meetingId, startDatetime, endDatetime, runId } = body;

    if (!meetingId || !startDatetime || !endDatetime || !runId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
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
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preferences = meeting.preferences as Record<string, any> || {};
    const isTest = preferences.is_test === true;
    const adminCalendarId = preferences.admin_calendar_id;
    const sendInvites = preferences.send_invites === true;

    if (!isTest) {
      await writeLog(supabase, meetingId, runId, "error", "error", "Not a test booking");
      return new Response(JSON.stringify({ error: "Not a test booking" }), {
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
    let lawmaticsError: string | null = null;

    await writeLog(supabase, meetingId, runId, "lawmatics_start", "info", "Checking Lawmatics connection...");

    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lawmaticsConnection?.access_token) {
      await writeLog(supabase, meetingId, runId, "lawmatics_request", "info", "Creating Lawmatics event...");

      try {
        const client = meeting.external_attendees?.[0];
        const eventName = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;

        const descriptionParts = [
          "⚠️ TEST BOOKING - Created from Admin Test My Booking",
          "",
          `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
          `Duration: ${meeting.duration_minutes} minutes`,
          `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
          hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
        ].filter(Boolean).join("\n");

        const lawmaticsPayload: Record<string, any> = {
          name: eventName,
          starts_at: startDatetime,
          ends_at: endDatetime,
          description: descriptionParts,
        };

        if (meeting.meeting_types?.lawmatics_event_type_id) {
          lawmaticsPayload.event_type_id = meeting.meeting_types.lawmatics_event_type_id;
        }

        if (meeting.location_mode === "InPerson" && meeting.rooms?.lawmatics_location_id) {
          lawmaticsPayload.location_id = meeting.rooms.lawmatics_location_id;
        }

        const lawmaticsResponse = await fetch("https://api.lawmatics.com/v1/events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lawmaticsConnection.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(lawmaticsPayload),
        });

        if (lawmaticsResponse.ok) {
          const responseData = await lawmaticsResponse.json();
          lawmaticsAppointmentId = responseData.data?.id || responseData.id || null;
          await writeLog(supabase, meetingId, runId, "lawmatics_success", "success", "Lawmatics event created", {
            appointmentId: lawmaticsAppointmentId,
            status: lawmaticsResponse.status,
          });
        } else {
          const errorText = await lawmaticsResponse.text();
          lawmaticsError = `Status ${lawmaticsResponse.status}: ${errorText.slice(0, 200)}`;
          await writeLog(supabase, meetingId, runId, "lawmatics_error", "error", "Lawmatics API error", {
            status: lawmaticsResponse.status,
            error: errorText.slice(0, 500),
          });
        }
      } catch (err) {
        lawmaticsError = err instanceof Error ? err.message : String(err);
        await writeLog(supabase, meetingId, runId, "lawmatics_error", "error", "Lawmatics request failed", { error: lawmaticsError });
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
    let googleError: string | null = null;

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
          start: { dateTime: startDatetime, timeZone: meeting.timezone || "America/New_York" },
          end: { dateTime: endDatetime, timeZone: meeting.timezone || "America/New_York" },
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
          googleError = `Status ${calendarResponse.status}: ${errorText.slice(0, 200)}`;
          await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar API error", {
            status: calendarResponse.status,
            error: errorText.slice(0, 500),
          });
        }
      } catch (err) {
        googleError = err instanceof Error ? err.message : String(err);
        await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar request failed", { error: googleError });
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
    const hasErrors = lawmaticsError || googleError;
    await writeLog(
      supabase,
      meetingId,
      runId,
      "done",
      hasErrors ? "warn" : "success",
      hasErrors ? "Test booking completed with some errors" : "Test booking completed successfully",
      {
        lawmaticsAppointmentId,
        lawmaticsError,
        googleEventId,
        googleError,
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
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        meetingId,
        lawmaticsAppointmentId,
        googleEventId,
        hasErrors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in confirm-test-booking:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
