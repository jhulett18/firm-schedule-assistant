import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PublicBookingInfoRequest {
  token: string;
}

interface SafeMeetingSummary {
  meetingTypeName: string;
  durationMinutes: number;
  locationMode: "Zoom" | "InPerson";
  timezone: string;
  startDatetime?: string;
  endDatetime?: string;
}

interface PublicBookingInfoResponse {
  state: "needs_scheduling" | "already_booked" | "expired" | "cancelled" | "error";
  meeting?: SafeMeetingSummary;
  contact?: {
    phone?: string;
    email?: string;
    message?: string;
  };
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: PublicBookingInfoRequest = await req.json();
    const { token } = body;

    if (!token) {
      return new Response(
        JSON.stringify({ state: "error", error: "Token is required" } as PublicBookingInfoResponse),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetching booking info for token:", token);

    // 1. Fetch booking request by token
    const { data: bookingRequest, error: brError } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();

    if (brError) {
      console.error("Error fetching booking request:", brError);
      return new Response(
        JSON.stringify({ state: "error", error: "Failed to fetch booking information" } as PublicBookingInfoResponse),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!bookingRequest) {
      return new Response(
        JSON.stringify({ state: "error", error: "Booking link not found" } as PublicBookingInfoResponse),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch meeting details (safe info only)
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        id,
        duration_minutes,
        location_mode,
        status,
        start_datetime,
        end_datetime,
        timezone,
        meeting_types (name)
      `)
      .eq("id", bookingRequest.meeting_id)
      .maybeSingle();

    if (meetingError || !meeting) {
      console.error("Error fetching meeting:", meetingError);
      return new Response(
        JSON.stringify({ state: "error", error: "Meeting not found" } as PublicBookingInfoResponse),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch contact settings
    const { data: contactSettings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["public_contact_phone", "public_contact_email", "public_contact_message"]);

    const contact: PublicBookingInfoResponse["contact"] = {};
    if (contactSettings) {
      for (const setting of contactSettings) {
        if (setting.key === "public_contact_phone") contact.phone = setting.value;
        if (setting.key === "public_contact_email") contact.email = setting.value;
        if (setting.key === "public_contact_message") contact.message = setting.value;
      }
    }

    // 4. Build safe meeting summary (no internal data)
    const safeMeeting: SafeMeetingSummary = {
      meetingTypeName: (meeting.meeting_types as any)?.name || "Meeting",
      durationMinutes: meeting.duration_minutes,
      locationMode: meeting.location_mode,
      timezone: meeting.timezone,
    };

    // 5. Determine state
    let state: PublicBookingInfoResponse["state"] = "needs_scheduling";
    const isExpired = new Date(bookingRequest.expires_at) < new Date() || bookingRequest.status === "Expired";

    // Check if cancelled
    if (meeting.status === "Cancelled") {
      state = "cancelled";
    }
    // Check if expired
    else if (isExpired) {
      state = "expired";
    }
    // Check if already booked
    else if (bookingRequest.status === "Completed" || meeting.status === "Booked") {
      state = "already_booked";
      safeMeeting.startDatetime = meeting.start_datetime || undefined;
      safeMeeting.endDatetime = meeting.end_datetime || undefined;
    }

    console.log("Returning booking info with state:", state);

    const response: PublicBookingInfoResponse = {
      state,
      meeting: safeMeeting,
      contact: Object.keys(contact).length > 0 ? contact : undefined,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in public-booking-info:", error);
    return new Response(
      JSON.stringify({ state: "error", error: error instanceof Error ? error.message : "Unknown error" } as PublicBookingInfoResponse),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
