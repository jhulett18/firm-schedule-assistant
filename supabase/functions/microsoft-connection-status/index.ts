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

    // Check if caller is admin
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    const isAdmin = !!adminRole;

    // Parse request body
    const body = await req.json().catch(() => ({}));
    let targetInternalUserId = body.internalUserId || callerUser.id;

    // If requesting another user's data, must be admin
    if (targetInternalUserId !== callerUser.id && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Microsoft calendar connection
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
        JSON.stringify({
          connected: false,
          verified_ok: null,
          verified_at: null,
          error: null,
        }),
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

    // Try a lightweight Microsoft Graph API call
    let verifiedOk = false;
    let verifiedError: string | null = null;
    let calendarListCount: number | null = null;

    try {
      // Get calendars list to verify connection
      const calendarResponse = await fetch(
        "https://graph.microsoft.com/v1.0/me/calendars?$top=1",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (calendarResponse.ok) {
        const calendarData = await calendarResponse.json();
        verifiedOk = true;
        calendarListCount = calendarData.value?.length || 0;
      } else if (calendarResponse.status === 401 && connection.refresh_token) {
        // Try refresh and retry once
        console.log("Got 401, attempting token refresh...");
        const refreshResult = await refreshAccessToken(
          connection.id,
          connection.refresh_token,
          supabase
        );

        if (refreshResult) {
          const retryResponse = await fetch(
            "https://graph.microsoft.com/v1.0/me/calendars?$top=1",
            {
              headers: { Authorization: `Bearer ${refreshResult.access_token}` },
            }
          );

          if (retryResponse.ok) {
            const calendarData = await retryResponse.json();
            verifiedOk = true;
            calendarListCount = calendarData.value?.length || 0;
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

    // Update verification fields
    const verifiedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("calendar_connections")
      .update({
        last_verified_at: verifiedAt,
        last_verified_ok: verifiedOk,
        last_verified_error: verifiedError,
        last_calendar_list_count: calendarListCount,
        updated_at: verifiedAt,
      })
      .eq("id", connection.id);

    if (updateError) {
      console.error("Failed to update verification fields:", updateError);
    }

    return new Response(
      JSON.stringify({
        connected: true,
        verified_ok: verifiedOk,
        verified_at: verifiedAt,
        error: verifiedError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in microsoft-connection-status:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
