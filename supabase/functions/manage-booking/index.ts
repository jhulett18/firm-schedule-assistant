import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lawmaticsReadEvent, lawmaticsUpdateEvent } from "../_shared/lawmatics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ManageAction = "reschedule" | "cancel";

interface ManageBookingRequest {
  token: string;
  action: ManageAction;
}

interface ManageBookingResponse {
  success: boolean;
  action?: ManageAction;
  meetingId?: string;
  bookingRequestId?: string;
  meetingStatus?: string;
  bookingStatus?: string;
  expiresAt?: string;
  warnings?: string[];
  error?: string;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAppSettingNumber(
  supabase: any,
  key: string,
  fallback: number
): Promise<number> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  const parsed = parseNumber(data?.value);
  return parsed ?? fallback;
}

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

async function cancelLawmaticsAppointment(
  supabase: any,
  appointmentId: string | null,
  warnings: string[]
): Promise<void> {
  if (!appointmentId) return;

  const { data: lawmaticsConnection } = await supabase
    .from("lawmatics_connections")
    .select("access_token")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lawmaticsConnection?.access_token) {
    warnings.push("Lawmatics not connected; appointment was not updated.");
    return;
  }

  const accessToken = lawmaticsConnection.access_token;
  const existing = await lawmaticsReadEvent(accessToken, appointmentId);
  const existingName = typeof existing?.name === "string" ? existing.name : null;
  const cancelledName =
    existingName && !existingName.toLowerCase().startsWith("cancelled")
      ? `Cancelled - ${existingName}`
      : existingName || "Cancelled appointment";

  const primaryPayload: Record<string, unknown> = {
    status: "cancelled",
    name: cancelledName,
  };

  const primaryUpdate = await lawmaticsUpdateEvent(accessToken, appointmentId, "PATCH", primaryPayload);
  if (primaryUpdate.ok) return;

  if (existingName) {
    const fallbackUpdate = await lawmaticsUpdateEvent(accessToken, appointmentId, "PATCH", {
      name: cancelledName,
    });
    if (fallbackUpdate.ok) return;
  }

  warnings.push(`Lawmatics update failed for appointment ${appointmentId}.`);
}

async function cancelGoogleEvents(
  supabase: any,
  meetingId: string,
  warnings: string[]
): Promise<void> {
  const { data: googleEvents } = await supabase
    .from("meeting_google_events")
    .select("user_id, google_calendar_id, google_event_id")
    .eq("meeting_id", meetingId);

  for (const ev of googleEvents || []) {
    const { data: connection } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("provider", "google")
      .eq("user_id", ev.user_id)
      .maybeSingle();

    if (!connection) {
      warnings.push(`Google connection missing for user ${ev.user_id}.`);
      continue;
    }

    const { accessToken, error: tokenError } = await refreshGoogleTokenIfNeeded(supabase, connection);
    if (!accessToken) {
      warnings.push(tokenError || `Google token error for user ${ev.user_id}.`);
      continue;
    }

    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev.google_calendar_id)}/events/${encodeURIComponent(ev.google_event_id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!res.ok && res.status !== 404 && res.status !== 410) {
        warnings.push(`Google event delete failed for user ${ev.user_id} (${res.status}).`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Google event delete failed for user ${ev.user_id}: ${msg}`);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let body: ManageBookingRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token, action } = body;
    if (!token || (action !== "reschedule" && action !== "cancel")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid fields: token, action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: bookingRequest, error: brError } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();

    if (brError || !bookingRequest) {
      return new Response(JSON.stringify({ success: false, error: "Booking link not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bookingRequest.status === "Expired") {
      return new Response(JSON.stringify({ success: false, error: "This booking link has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bookingRequest.expires_at && new Date(bookingRequest.expires_at) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: "This booking link has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("id, status, start_datetime, end_datetime, timezone, preferences, lawmatics_appointment_id")
      .eq("id", bookingRequest.meeting_id)
      .maybeSingle();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ success: false, error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reschedule" && meeting.status === "Cancelled") {
      return new Response(JSON.stringify({ success: false, error: "This appointment was cancelled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel" && meeting.status === "Cancelled") {
      const response: ManageBookingResponse = {
        success: true,
        action,
        meetingId: meeting.id,
        bookingRequestId: bookingRequest.id,
        meetingStatus: meeting.status,
        bookingStatus: bookingRequest.status,
        expiresAt: bookingRequest.expires_at || undefined,
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const warnings: string[] = [];
    const lawmaticsAppointmentId = meeting.lawmatics_appointment_id as string | null;

    const preferences = (meeting.preferences || {}) as Record<string, unknown>;
    const preferredNotice = parseNumber(preferences.minNoticeHours);
    const minNoticeHours = preferredNotice ?? (await fetchAppSettingNumber(supabase, "min_notice_hours", 24));

    if (meeting.start_datetime) {
      const cutoffMs = minNoticeHours * 60 * 60 * 1000;
      const cutoffAt = new Date(meeting.start_datetime).getTime() - cutoffMs;
      if (Date.now() > cutoffAt) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Changes are not allowed within ${minNoticeHours} hours of the appointment`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (action === "reschedule") {
      await cancelLawmaticsAppointment(supabase, lawmaticsAppointmentId, warnings);
      await cancelGoogleEvents(supabase, meeting.id, warnings);

      // Fetch full meeting data for notification
      const { data: fullMeeting } = await supabase
        .from("meetings")
        .select("created_by_user_id, external_attendees")
        .eq("id", meeting.id)
        .single();

      const preferredExpiresDays = parseNumber(preferences.bookingRequestExpiresDays);
      const expiresDays = preferredExpiresDays ?? (await fetchAppSettingNumber(supabase, "booking_request_expires_days", 7));
      const clampedExpiresDays = Math.max(1, expiresDays);
      const newExpiresAt = new Date(Date.now() + clampedExpiresDays * 24 * 60 * 60 * 1000).toISOString();

      const { error: meetingUpdateError } = await supabase
        .from("meetings")
        .update({
          status: "Rescheduled",
          start_datetime: null,
          end_datetime: null,
          lawmatics_appointment_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", meeting.id);

      if (meetingUpdateError) {
        return new Response(JSON.stringify({ success: false, error: "Failed to reopen the appointment" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: brUpdateError } = await supabase
        .from("booking_requests")
        .update({ status: "Open", expires_at: newExpiresAt })
        .eq("id", bookingRequest.id);

      if (brUpdateError) {
        return new Response(JSON.stringify({ success: false, error: "Failed to reopen booking link" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("meeting_google_events").delete().eq("meeting_id", meeting.id);

      await supabase.from("audit_logs").insert({
        action_type: "Rescheduled",
        meeting_id: meeting.id,
        details_json: {
          previous_status: meeting.status,
          previous_start_datetime: meeting.start_datetime,
          previous_end_datetime: meeting.end_datetime,
          reopened_at: new Date().toISOString(),
          booking_request_id: bookingRequest.id,
        },
      });

      // Create notification for meeting creator
      if (fullMeeting?.created_by_user_id) {
        let clientName = "A client";
        const attendees = fullMeeting.external_attendees as Array<{ name?: string; email?: string }> | null;
        if (attendees && attendees.length > 0) {
          clientName = attendees[0]?.name || attendees[0]?.email || "A client";
        }

        await supabase.from("notifications").insert({
          user_id: fullMeeting.created_by_user_id,
          type: "meeting_rescheduled",
          title: "Appointment Rescheduled",
          message: `${clientName} has requested to reschedule their appointment.`,
          meeting_id: meeting.id,
        });
      }

      const response: ManageBookingResponse = {
        success: true,
        action,
        meetingId: meeting.id,
        bookingRequestId: bookingRequest.id,
        meetingStatus: "Rescheduled",
        bookingStatus: "Open",
        expiresAt: newExpiresAt,
        warnings: warnings.length ? warnings : undefined,
      };

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel") {
      await cancelLawmaticsAppointment(supabase, lawmaticsAppointmentId, warnings);
      await cancelGoogleEvents(supabase, meeting.id, warnings);

      // Fetch full meeting data for notification
      const { data: fullMeeting } = await supabase
        .from("meetings")
        .select("created_by_user_id, external_attendees")
        .eq("id", meeting.id)
        .single();

      const { error: meetingUpdateError } = await supabase
        .from("meetings")
        .update({
          status: "Cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", meeting.id);

      if (meetingUpdateError) {
        return new Response(JSON.stringify({ success: false, error: "Failed to cancel the appointment" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase
        .from("booking_requests")
        .update({ status: "Expired", expires_at: new Date().toISOString() })
        .eq("id", bookingRequest.id);

      // Clean up Google event records (matches reschedule behavior)
      await supabase.from("meeting_google_events").delete().eq("meeting_id", meeting.id);

      await supabase.from("audit_logs").insert({
        action_type: "Cancelled",
        meeting_id: meeting.id,
        details_json: {
          previous_status: meeting.status,
          previous_start_datetime: meeting.start_datetime,
          previous_end_datetime: meeting.end_datetime,
          cancelled_at: new Date().toISOString(),
          booking_request_id: bookingRequest.id,
        },
      });

      // Create notification for meeting creator
      if (fullMeeting?.created_by_user_id) {
        let clientName = "A client";
        const attendees = fullMeeting.external_attendees as Array<{ name?: string; email?: string }> | null;
        if (attendees && attendees.length > 0) {
          clientName = attendees[0]?.name || attendees[0]?.email || "A client";
        }

        await supabase.from("notifications").insert({
          user_id: fullMeeting.created_by_user_id,
          type: "meeting_cancelled",
          title: "Appointment Cancelled",
          message: `${clientName} has cancelled their appointment.`,
          meeting_id: meeting.id,
        });
      }

      const response: ManageBookingResponse = {
        success: true,
        action,
        meetingId: meeting.id,
        bookingRequestId: bookingRequest.id,
        meetingStatus: "Cancelled",
        bookingStatus: "Expired",
        expiresAt: new Date().toISOString(),
        warnings: warnings.length ? warnings : undefined,
      };

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Unhandled action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
