import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lawmaticsClientId = Deno.env.get("LAWMATICS_CLIENT_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!lawmaticsClientId) {
      console.error("LAWMATICS_CLIENT_ID not configured");
      return new Response(
        JSON.stringify({ error: "Lawmatics OAuth not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user is authenticated and is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
    const { data: isAdmin } = await supabase.rpc("has_admin_role", { _user_id: user.id });
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get internal user ID for state
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (userError || !userData) {
      console.error("User lookup error:", userError);
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build state parameter with user ID and timestamp for validation
    const state = btoa(JSON.stringify({
      userId: userData.id,
      timestamp: Date.now(),
    }));

    // Build the Lawmatics authorization URL
    const redirectUri = `${supabaseUrl}/functions/v1/lawmatics-oauth-callback`;
    const authUrl = new URL("https://app.lawmatics.com/oauth/authorize");
    authUrl.searchParams.set("client_id", lawmaticsClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    console.log("Generated Lawmatics OAuth URL for user:", userData.id);

    return new Response(
      JSON.stringify({ url: authUrl.toString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in lawmatics-oauth-start:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
