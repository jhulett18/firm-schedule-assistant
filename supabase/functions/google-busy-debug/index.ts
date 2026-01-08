import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BusyDebugRequest {
  internalUserId: string;
  start: string; // ISO datetime
  end: string;   // ISO datetime
}

interface BusyIntervalWithCalendar {
  start: string;
  end: string;
  calendarId: string;
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

    return { access_token: tokens.access_token, expires_at: tokenExpiresAt };
  } catch (err) {
    console.error("Error during token refresh:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase configuration");
    }

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's token to verify auth
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

    // Create service role client for database operations
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if caller is admin
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

    // Parse request body
    const body: BusyDebugRequest = await req.json();
    const { internalUserId, start, end } = body;

    if (!internalUserId || !start || !end) {
      return new Response(JSON.stringify({ error: "Missing required fields: internalUserId, start, end" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load calendar connection
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", internalUserId)
      .eq("provider", "google")
      .maybeSingle();

    if (connError) {
      throw connError;
    }

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "No Google connection found", calendarsChecked: [], busyIntervals: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token is expired or expiring soon
    let accessToken = connection.access_token;
    const tokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (tokenExpiresAt && tokenExpiresAt < fiveMinutesFromNow && connection.refresh_token) {
      console.log("Token expired or expiring soon, refreshing...");
      const refreshResult = await refreshAccessToken(
        connection.id,
        connection.refresh_token,
        supabase
      );
      if (refreshResult) {
        accessToken = refreshResult.access_token;
      }
    }

    // Use selected_calendar_ids if available, otherwise fall back to ["primary"]
    const calendarsToCheck: string[] = connection.selected_calendar_ids?.length
      ? connection.selected_calendar_ids
      : ["primary"];

    console.log(`Debug: Checking ${calendarsToCheck.length} calendars for user ${internalUserId}`);

    // Fetch busy intervals
    const busyIntervals: BusyIntervalWithCalendar[] = [];

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
          items: calendarsToCheck.map(id => ({ id })),
        }),
      });
      return response;
    };

    let response = await doRequest(accessToken);

    // If 401 and we have refresh token, refresh and retry
    if (response.status === 401 && connection.refresh_token) {
      console.log("Got 401, attempting refresh...");
      const refreshResult = await refreshAccessToken(connection.id, connection.refresh_token, supabase);
      if (refreshResult) {
        accessToken = refreshResult.access_token;
        response = await doRequest(accessToken);
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google FreeBusy API error:", errorText);
      return new Response(
        JSON.stringify({ 
          error: `Google Calendar API error: ${response.status}`, 
          calendarsChecked: calendarsToCheck, 
          busyIntervals: [] 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();

    for (const calendarId of Object.keys(data.calendars || {})) {
      const calendar = data.calendars[calendarId];
      if (calendar.busy) {
        for (const interval of calendar.busy) {
          busyIntervals.push({
            start: interval.start,
            end: interval.end,
            calendarId,
          });
        }
      }
      if (calendar.errors) {
        console.warn(`Errors for calendar ${calendarId}:`, calendar.errors);
      }
    }

    // Sort by start time
    busyIntervals.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    console.log(`Debug: Found ${busyIntervals.length} busy intervals across ${calendarsToCheck.length} calendars`);

    return new Response(
      JSON.stringify({
        calendarsChecked: calendarsToCheck,
        busyIntervals,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in google-busy-debug:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});