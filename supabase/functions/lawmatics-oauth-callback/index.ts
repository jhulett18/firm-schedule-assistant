import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Get environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const lawmaticsClientId = Deno.env.get("LAWMATICS_CLIENT_ID");
    const lawmaticsClientSecret = Deno.env.get("LAWMATICS_CLIENT_SECRET");

    // Base redirect URL from environment
    const envBaseUrl = Deno.env.get("APP_BASE_URL") || "https://lovable.dev";

    // Helper to validate redirect URL (prevent open redirect)
    const validateRedirectUrl = (stateBase: string | undefined): string => {
      if (!stateBase) return envBaseUrl;
      
      // Allow if matches env base, ends with .lovable.app, or is localhost
      if (
        stateBase.startsWith(envBaseUrl) ||
        stateBase.endsWith(".lovable.app") ||
        stateBase.includes("localhost")
      ) {
        return stateBase;
      }
      
      console.log("Invalid redirect URL in state, falling back to env:", stateBase);
      return envBaseUrl;
    };

    // Handle OAuth errors (use env base for early errors before state is parsed)
    if (error) {
      console.error("OAuth error from Lawmatics:", error);
      return Response.redirect(`${envBaseUrl}/admin/settings?lawmatics_error=${encodeURIComponent(error)}`);
    }

    // Validate required parameters
    if (!code || !state) {
      console.error("Missing code or state parameter");
      return Response.redirect(`${envBaseUrl}/admin/settings?lawmatics_error=missing_params`);
    }

    // Validate state parameter
    let stateData: { userId: string; timestamp: number; appUrl?: string };
    let redirectBase: string;
    try {
      stateData = JSON.parse(atob(state));
      const stateAge = Date.now() - stateData.timestamp;
      
      // Validate redirect URL from state
      const validatedBase = validateRedirectUrl(stateData.appUrl);
      redirectBase = `${validatedBase}/admin/settings`;
      
      // State should be less than 60 minutes old (increased for admin setup)
      if (stateAge > 60 * 60 * 1000) {
        console.error("State expired, age:", stateAge);
        return Response.redirect(`${redirectBase}?lawmatics_error=state_expired`);
      }
    } catch (e) {
      console.error("Invalid state parameter:", e);
      return Response.redirect(`${envBaseUrl}/admin/settings?lawmatics_error=invalid_state`);
    }

    // Exchange authorization code for access token
    // Try multiple endpoints - api.lawmatics.com first, then app.lawmatics.com
    const tokenUrls = [
      "https://api.lawmatics.com/oauth/token",
      "https://app.lawmatics.com/oauth/token",
    ];
    const redirectUri = `${supabaseUrl}/functions/v1/lawmatics-oauth-callback`;

    console.log("Exchanging code for token...");

    let tokenData: { access_token: string } | null = null;
    let lastStatus = 0;
    let lastBody = "";

    for (const tokenUrl of tokenUrls) {
      console.log("Trying token endpoint:", tokenUrl);
      
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: redirectUri,
          client_id: lawmaticsClientId!,
          client_secret: lawmaticsClientSecret!,
        }),
      });

      lastStatus = tokenResponse.status;
      
      if (tokenResponse.ok) {
        tokenData = await tokenResponse.json();
        console.log("Token exchange successful with:", tokenUrl);
        break;
      }

      lastBody = await tokenResponse.text();
      console.error("Token exchange failed:", tokenUrl, lastStatus, lastBody);

      // Only try next URL if 404 or 405 (endpoint not found/method not allowed)
      if (lastStatus !== 404 && lastStatus !== 405) {
        break;
      }
    }

    if (!tokenData) {
      // Truncate detail to max 200 chars and exclude any secrets
      const safeDetail = lastBody.slice(0, 200).replace(/client_secret[^&]*/gi, "").replace(/access_token[^&]*/gi, "");
      return Response.redirect(
        `${redirectBase}?lawmatics_error=token_exchange_failed&status=${lastStatus}&detail=${encodeURIComponent(safeDetail)}`
      );
    }
    console.log("Token exchange successful");

    // Store the access token in the database
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Delete any existing connections (we only need one firm-wide connection)
    await supabase.from("lawmatics_connections").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert the new connection
    const { error: insertError } = await supabase.from("lawmatics_connections").insert({
      access_token: tokenData.access_token,
      connected_by_user_id: stateData.userId,
    });

    if (insertError) {
      console.error("Failed to store connection:", insertError);
      return Response.redirect(`${redirectBase}?lawmatics_error=storage_failed`);
    }

    console.log("Lawmatics connection stored successfully for user:", stateData.userId);

    return Response.redirect(`${redirectBase}?lawmatics_success=true`);
  } catch (error) {
    console.error("Error in lawmatics-oauth-callback:", error);
    const envBaseUrl = Deno.env.get("APP_BASE_URL") || "https://lovable.dev";
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return Response.redirect(`${envBaseUrl}/admin/settings?lawmatics_error=${encodeURIComponent(errorMsg)}`);
  }
});
