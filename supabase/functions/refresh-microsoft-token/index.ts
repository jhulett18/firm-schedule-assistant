import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefreshResult {
  connectionId: string;
  success: boolean;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
    const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
      throw new Error("Microsoft OAuth credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Find connections expiring in the next 5 minutes
    const expiryThreshold = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: expiringConnections, error: fetchError } = await supabase
      .from("calendar_connections")
      .select("id, user_id, refresh_token")
      .eq("provider", "microsoft")
      .not("refresh_token", "is", null)
      .lt("token_expires_at", expiryThreshold);

    if (fetchError) {
      console.error("Failed to fetch expiring connections:", fetchError);
      throw fetchError;
    }

    if (!expiringConnections || expiringConnections.length === 0) {
      return new Response(JSON.stringify({ message: "No tokens need refresh", refreshed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${expiringConnections.length} Microsoft connections to refresh`);

    const results: RefreshResult[] = [];

    for (const connection of expiringConnections) {
      try {
        const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: MICROSOFT_CLIENT_ID,
            client_secret: MICROSOFT_CLIENT_SECRET,
            refresh_token: connection.refresh_token!,
            grant_type: "refresh_token",
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error(`Token refresh failed for ${connection.id}:`, errorText);
          results.push({ connectionId: connection.id, success: false, error: errorText });
          continue;
        }

        const tokens = await tokenResponse.json();
        const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        const { error: updateError } = await supabase
          .from("calendar_connections")
          .update({
            access_token: tokens.access_token,
            token_expires_at: tokenExpiresAt,
            // Microsoft may return a new refresh token
            ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
            updated_at: new Date().toISOString(),
          })
          .eq("id", connection.id);

        if (updateError) {
          console.error(`Failed to update connection ${connection.id}:`, updateError);
          results.push({ connectionId: connection.id, success: false, error: updateError.message });
        } else {
          console.log(`Refreshed Microsoft token for connection ${connection.id}`);
          results.push({ connectionId: connection.id, success: true });
        }
      } catch (err) {
        console.error(`Error refreshing ${connection.id}:`, err);
        results.push({ connectionId: connection.id, success: false, error: String(err) });
      }
    }

    const successful = results.filter(r => r.success).length;
    return new Response(JSON.stringify({
      message: `Refreshed ${successful}/${results.length} Microsoft tokens`,
      refreshed: successful,
      results
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in refresh-microsoft-token:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
