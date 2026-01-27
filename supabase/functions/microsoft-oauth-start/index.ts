import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!MICROSOFT_CLIENT_ID) {
      throw new Error("MICROSOFT_CLIENT_ID not configured");
    }

    // Capture the calling app origin for redirect after OAuth
    let appUrl = req.headers.get("origin");
    if (!appUrl) {
      const referer = req.headers.get("referer");
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          appUrl = refererUrl.origin;
        } catch {
          // Invalid referer, will use fallback
        }
      }
    }
    // Fallback to APP_URL env var
    if (!appUrl) {
      appUrl = Deno.env.get("APP_URL") || "https://lovable.dev";
    }

    console.log("Captured app origin for OAuth redirect:", appUrl);

    // Get the user from the request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid user session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get internal user ID
    const { data: internalUser } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (!internalUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate state with user ID and app URL for redirect
    const state = btoa(JSON.stringify({
      userId: internalUser.id,
      timestamp: Date.now(),
      appUrl: appUrl,
    }));

    const redirectUri = `${SUPABASE_URL}/functions/v1/microsoft-oauth-callback`;

    // Microsoft Graph API scopes
    const scopes = [
      "Calendars.Read",
      "Calendars.ReadWrite",
      "User.Read",
      "offline_access", // Required for refresh tokens
    ].join(" ");

    // Microsoft identity platform OAuth 2.0 authorization endpoint
    // Using /common tenant for both personal and organizational accounts
    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);
    // Prompt for consent to ensure refresh token is issued
    authUrl.searchParams.set("prompt", "consent");

    console.log("Generated Microsoft OAuth URL for user:", internalUser.id);

    return new Response(JSON.stringify({ authUrl: authUrl.toString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in microsoft-oauth-start:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
