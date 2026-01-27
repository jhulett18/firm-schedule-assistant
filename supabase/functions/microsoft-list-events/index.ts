import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(
  connectionId: string,
  refreshToken: string,
  supabase: any
): Promise<{ access_token: string; expires_at: string } | null> {
  const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
  const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");

  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    console.error("Missing Microsoft OAuth credentials for refresh");
    return null;
  }

  try {
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
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

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  htmlLink: string;
  status: string;
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized", events: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", events: [] }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: callerUser, error: callerError } = await supabase
      .from("users")
      .select("id, auth_user_id")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "User not found", events: [] }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STRICT USER SCOPING
    const targetInternalUserId = callerUser.id;

    const body = await req.json().catch(() => ({}));
    const calendarId = body.calendarId; // Microsoft calendar ID or undefined for default
    const maxResults = Math.min(body.maxResults || 50, 100);

    // Default: now to 14 days from now
    const now = new Date();
    const fourteenDaysLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const timeMin = body.timeMin || now.toISOString();
    const timeMax = body.timeMax || fourteenDaysLater.toISOString();

    console.log("Loading Microsoft connection for caller:", targetInternalUserId);

    // Load calendar connection
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", targetInternalUserId)
      .eq("provider", "microsoft")
      .maybeSingle();

    if (connError) {
      throw connError;
    }

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "No Microsoft connection found", events: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let accessToken = connection.access_token;
    const tokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
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

    const fetchEvents = async (token: string): Promise<{ events: CalendarEvent[]; error: string | null }> => {
      // Microsoft Graph API uses calendarView for time-ranged event queries
      // If calendarId is specified, use that calendar; otherwise use default calendar
      const basePath = calendarId
        ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
        : "https://graph.microsoft.com/v1.0/me/calendarView";

      const params = new URLSearchParams({
        startDateTime: timeMin,
        endDateTime: timeMax,
        $top: String(maxResults),
        $orderby: "start/dateTime",
        $select: "id,subject,start,end,location,webLink,showAs,isCancelled,isAllDay",
      });

      const url = `${basePath}?${params}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { events: [], error: "AUTH_EXPIRED" };
        }
        const text = await response.text();
        return { events: [], error: `API error ${response.status}: ${text}` };
      }

      const data = await response.json();

      // Map Microsoft event format to our common format
      const events: CalendarEvent[] = (data.value || []).map((item: any) => {
        // Microsoft returns start/end as objects with dateTime and timeZone
        const startDateTime = item.start?.dateTime;
        const endDateTime = item.end?.dateTime;
        const isAllDay = item.isAllDay || false;

        return {
          id: item.id,
          summary: item.subject || "(No title)",
          start: isAllDay
            ? { date: startDateTime?.split("T")[0] }
            : { dateTime: startDateTime, timeZone: item.start?.timeZone || "UTC" },
          end: isAllDay
            ? { date: endDateTime?.split("T")[0] }
            : { dateTime: endDateTime, timeZone: item.end?.timeZone || "UTC" },
          location: item.location?.displayName || null,
          htmlLink: item.webLink || "",
          // Map Microsoft's showAs to status-like value
          status: item.isCancelled ? "cancelled" : "confirmed",
        };
      });

      return { events, error: null };
    };

    let result = await fetchEvents(accessToken);

    // If auth expired and we have refresh token, try refresh and retry
    if (result.error === "AUTH_EXPIRED" && connection.refresh_token) {
      console.log("Got 401, attempting token refresh...");
      const refreshResult = await refreshAccessToken(
        connection.id,
        connection.refresh_token,
        supabase
      );

      if (refreshResult) {
        result = await fetchEvents(refreshResult.access_token);
      } else {
        result = { events: [], error: "Token refresh failed" };
      }
    }

    return new Response(
      JSON.stringify({
        events: result.events,
        error: result.error,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in microsoft-list-events:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        events: []
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
