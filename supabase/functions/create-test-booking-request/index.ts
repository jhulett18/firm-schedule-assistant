import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateTestBookingRequest {
  meetingTypeId: string;
  durationMinutes: number;
  locationMode: "Zoom" | "InPerson";
  roomId?: string;
  adminCalendarId: string;
  sendInvites?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get caller's internal user ID
    const { data: callerUser, error: callerError } = await supabase
      .from("users")
      .select("id, name, email, auth_user_id")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin role
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body: CreateTestBookingRequest = await req.json();
    const {
      meetingTypeId,
      durationMinutes,
      locationMode,
      roomId,
      adminCalendarId,
      sendInvites = false,
    } = body;

    if (!meetingTypeId || !durationMinutes || !locationMode || !adminCalendarId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Creating test booking for admin:", callerUser.email);
    console.log("Meeting type:", meetingTypeId, "Duration:", durationMinutes, "Mode:", locationMode);
    console.log("Admin calendar ID:", adminCalendarId);

    // Create meeting record
    const meetingPreferences = {
      is_test: true,
      admin_calendar_id: adminCalendarId,
      admin_calendar_user_id: callerUser.id,
      post_to_google_calendar: true,
      send_invites: sendInvites,
      debug_progress_logs: true,
    };

    const externalAttendees = [
      {
        name: `${callerUser.name} (Test)`,
        email: callerUser.email,
      },
    ];

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        meeting_type_id: meetingTypeId,
        duration_minutes: durationMinutes,
        location_mode: locationMode,
        room_id: roomId || null,
        host_attorney_user_id: callerUser.id,
        created_by_user_id: callerUser.id,
        external_attendees: externalAttendees,
        preferences: meetingPreferences,
        status: "Draft",
        timezone: "America/New_York",
      })
      .select()
      .single();

    if (meetingError || !meeting) {
      console.error("Failed to create meeting:", meetingError);
      return new Response(JSON.stringify({ error: "Failed to create meeting" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Created meeting:", meeting.id);

    // Create booking request
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Expire in 24 hours

    const { data: bookingRequest, error: brError } = await supabase
      .from("booking_requests")
      .insert({
        meeting_id: meeting.id,
        status: "Open",
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (brError || !bookingRequest) {
      console.error("Failed to create booking request:", brError);
      // Cleanup meeting
      await supabase.from("meetings").delete().eq("id", meeting.id);
      return new Response(JSON.stringify({ error: "Failed to create booking request" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Created booking request:", bookingRequest.id, "Token:", bookingRequest.public_token);

    // Update meeting with booking_request_id
    await supabase
      .from("meetings")
      .update({ booking_request_id: bookingRequest.id })
      .eq("id", meeting.id);

    return new Response(
      JSON.stringify({
        success: true,
        meetingId: meeting.id,
        bookingRequestId: bookingRequest.id,
        publicToken: bookingRequest.public_token,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in create-test-booking-request:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
