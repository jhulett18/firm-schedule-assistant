import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Get the app URL for redirects
    const appUrl = Deno.env.get("APP_URL") || "https://lovable.dev";

    if (error) {
      console.error("OAuth error from Google:", error);
      return Response.redirect(`${appUrl}/admin/calendar?error=${error}`, 302);
    }

    if (!code || !state) {
      console.error("Missing code or state");
      return Response.redirect(`${appUrl}/admin/calendar?error=missing_params`, 302);
    }

    // Decode state to get user ID
    let stateData: { userId: string; timestamp: number };
    try {
      stateData = JSON.parse(atob(state));
    } catch {
      console.error("Invalid state parameter");
      return Response.redirect(`${appUrl}/admin/calendar?error=invalid_state`, 302);
    }

    // Check state timestamp (5 minute expiry)
    if (Date.now() - stateData.timestamp > 5 * 60 * 1000) {
      console.error("State expired");
      return Response.redirect(`${appUrl}/admin/calendar?error=state_expired`, 302);
    }

    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error("Missing Google OAuth credentials");
      return Response.redirect(`${appUrl}/admin/calendar?error=config_error`, 302);
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return Response.redirect(`${appUrl}/admin/calendar?error=token_exchange_failed`, 302);
    }

    const tokens = await tokenResponse.json();
    console.log("Token exchange successful");

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Store connection in database using service role
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Check if connection already exists
    const { data: existingConnection } = await supabase
      .from("calendar_connections")
      .select("id")
      .eq("user_id", stateData.userId)
      .eq("provider", "google")
      .single();

    if (existingConnection) {
      // Update existing connection
      const { error: updateError } = await supabase
        .from("calendar_connections")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          scopes: tokens.scope?.split(" ") || [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingConnection.id);

      if (updateError) {
        console.error("Failed to update connection:", updateError);
        return Response.redirect(`${appUrl}/admin/calendar?error=db_error`, 302);
      }
    } else {
      // Insert new connection
      const { error: insertError } = await supabase
        .from("calendar_connections")
        .insert({
          provider: "google",
          user_id: stateData.userId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          scopes: tokens.scope?.split(" ") || [],
        });

      if (insertError) {
        console.error("Failed to insert connection:", insertError);
        return Response.redirect(`${appUrl}/admin/calendar?error=db_error`, 302);
      }
    }

    console.log("Calendar connection saved for user:", stateData.userId);
    return Response.redirect(`${appUrl}/admin/calendar?success=true`, 302);
  } catch (error) {
    console.error("Error in google-oauth-callback:", error);
    const appUrl = Deno.env.get("APP_URL") || "https://lovable.dev";
    return Response.redirect(`${appUrl}/admin/calendar?error=unknown`, 302);
  }
});
