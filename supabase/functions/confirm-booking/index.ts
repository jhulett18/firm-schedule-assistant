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
  meeting_types?: { name: string } | null;
  rooms?: { name: string } | null;
  host_attorney?: { name: string; email: string } | null;
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

    // 2. Fetch meeting details with relations
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        *,
        meeting_types (name),
        rooms (name)
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

    // 5. Create appointment in Lawmatics via direct API
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
      try {
        const client = meeting.external_attendees?.[0];
        const eventName = `${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;
        
        // Build description
        const descriptionParts = [
          `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
          `Duration: ${meeting.duration_minutes} minutes`,
          `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || meeting.in_person_location_choice || "In Person") : "Zoom"}`,
          hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
          client?.name ? `Client: ${client.name}` : null,
          client?.email ? `Client Email: ${client.email}` : null,
          client?.phone ? `Client Phone: ${client.phone}` : null,
        ].filter(Boolean).join("\n");

        const lawmaticsPayload = {
          name: eventName,
          starts_at: startDatetime,
          ends_at: endDatetime,
          description: descriptionParts,
        };

        console.log("Creating Lawmatics event:", JSON.stringify(lawmaticsPayload));

        const lawmaticsResponse = await fetch("https://api.lawmatics.com/v1/events", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${lawmaticsConnection.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(lawmaticsPayload),
        });

        if (lawmaticsResponse.ok) {
          const responseData = await lawmaticsResponse.json();
          lawmaticsAppointmentId = responseData.data?.id || responseData.id || null;
          console.log("Lawmatics event created, ID:", lawmaticsAppointmentId);
        } else {
          const errorText = await lawmaticsResponse.text();
          lawmaticsError = `Lawmatics API error: ${lawmaticsResponse.status} - ${errorText}`;
          console.error(lawmaticsError);
        }
      } catch (err) {
        lawmaticsError = `Lawmatics API error: ${err instanceof Error ? err.message : String(err)}`;
        console.error(lawmaticsError);
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

    // 8. Log success audit
    await supabase.from("audit_logs").insert({
      action_type: "Booked",
      meeting_id: meeting.id,
      details_json: {
        booked_at: new Date().toISOString(),
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        lawmatics_appointment_id: lawmaticsAppointmentId,
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
