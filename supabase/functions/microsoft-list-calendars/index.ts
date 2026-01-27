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

    // Update the connection with new token
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

interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
  selected: boolean;
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

    // Get caller's internal user ID
    const { data: callerUser, error: callerError } = await supabase
      .from("users")
      .select("id, auth_user_id")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STRICT USER SCOPING: Always use the caller's internal user ID
    const targetInternalUserId = callerUser.id;

    console.log("Loading Microsoft connection for caller:", targetInternalUserId);

    // Load calendar connection for the CALLER ONLY
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
        JSON.stringify({ error: "No Microsoft connection found", calendars: [] }),
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

    // Fetch calendar list from Microsoft Graph API
    let calendars: CalendarInfo[] = [];
    let verifiedOk = false;
    let verifiedError: string | null = null;

    try {
      const calendarResponse = await fetch(
        "https://graph.microsoft.com/v1.0/me/calendars",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (calendarResponse.ok) {
        const calendarData = await calendarResponse.json();
        verifiedOk = true;

        // Map Microsoft calendar format to our common format
        calendars = (calendarData.value || []).map((cal: any) => ({
          id: cal.id,
          summary: cal.name || cal.id,
          primary: cal.isDefaultCalendar || false,
          // Microsoft uses different permission model - map to similar roles
          accessRole: cal.canEdit ? "owner" : (cal.canShare ? "writer" : "reader"),
          timeZone: cal.timeZone || "unknown",
          // In Microsoft, "selected" isn't directly exposed; we'll consider writable calendars as selected
          selected: cal.canEdit || cal.isDefaultCalendar || false,
        }));
      } else if (calendarResponse.status === 401 && connection.refresh_token) {
        // Try refresh and retry once
        console.log("Got 401, attempting token refresh...");
        const refreshResult = await refreshAccessToken(
          connection.id,
          connection.refresh_token,
          supabase
        );

        if (refreshResult) {
          accessToken = refreshResult.access_token;
          const retryResponse = await fetch(
            "https://graph.microsoft.com/v1.0/me/calendars",
            {
              headers: { Authorization: `Bearer ${refreshResult.access_token}` },
            }
          );

          if (retryResponse.ok) {
            const calendarData = await retryResponse.json();
            verifiedOk = true;

            calendars = (calendarData.value || []).map((cal: any) => ({
              id: cal.id,
              summary: cal.name || cal.id,
              primary: cal.isDefaultCalendar || false,
              accessRole: cal.canEdit ? "owner" : (cal.canShare ? "writer" : "reader"),
              timeZone: cal.timeZone || "unknown",
              selected: cal.canEdit || cal.isDefaultCalendar || false,
            }));
          } else {
            verifiedError = `API call failed after refresh: ${retryResponse.status}`;
          }
        } else {
          verifiedError = "Token refresh failed";
        }
      } else {
        verifiedError = `API call failed: ${calendarResponse.status}`;
      }
    } catch (apiError) {
      verifiedError = `API error: ${apiError instanceof Error ? apiError.message : String(apiError)}`;
    }

    // Build selected calendar IDs list
    const validAccessRoles = ["owner", "writer", "reader"];
    const selectedCalendarIds: string[] = [];

    for (const cal of calendars) {
      if (!validAccessRoles.includes(cal.accessRole)) continue;

      // Always include primary (default calendar), or include if marked as selected
      if (cal.primary || cal.selected) {
        if (!selectedCalendarIds.includes(cal.id)) {
          selectedCalendarIds.push(cal.id);
        }
      }
    }

    // Ensure primary is at the front if present
    const primaryCal = calendars.find(c => c.primary);
    if (primaryCal && selectedCalendarIds.includes(primaryCal.id)) {
      const idx = selectedCalendarIds.indexOf(primaryCal.id);
      if (idx > 0) {
        selectedCalendarIds.splice(idx, 1);
        selectedCalendarIds.unshift(primaryCal.id);
      }
    }

    console.log(`Selected Microsoft calendar IDs to persist: ${selectedCalendarIds.length}`, selectedCalendarIds);

    // Update verification fields AND persist selected_calendar_ids
    const verifiedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("calendar_connections")
      .update({
        selected_calendar_ids: selectedCalendarIds,
        last_verified_at: verifiedAt,
        last_verified_ok: verifiedOk,
        last_verified_error: verifiedError,
        last_calendar_list_count: calendars.length,
        updated_at: verifiedAt,
      })
      .eq("id", connection.id);

    if (updateError) {
      console.error("Failed to update verification fields:", updateError);
    }

    return new Response(
      JSON.stringify({
        calendars,
        selectedCalendarIds,
        error: verifiedError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in microsoft-list-calendars:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", calendars: [] }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
