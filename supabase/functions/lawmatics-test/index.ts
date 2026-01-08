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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Check admin role
    const { data: isAdmin } = await userClient.rpc("has_admin_role", { _user_id: userId });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client for database operations
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch Lawmatics connection
    const { data: lawmaticsConnection, error: connError } = await serviceClient
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connError || !lawmaticsConnection?.access_token) {
      const errorMsg = "No Lawmatics connection found";
      await storeTestResult(serviceClient, false, errorMsg);
      return new Response(JSON.stringify({ ok: false, status: 0, message: errorMsg }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Test the Lawmatics API - try /users/me first, then fallback to /events
    let testOk = false;
    let testStatus = 0;
    let testMessage = "";

    console.log("Testing Lawmatics API connection...");

    // Try /users/me endpoint first
    try {
      const usersResponse = await fetch("https://api.lawmatics.com/v1/users/me", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${lawmaticsConnection.access_token}`,
          "Content-Type": "application/json",
        },
      });

      testStatus = usersResponse.status;

      if (usersResponse.ok) {
        testOk = true;
        const userData = await usersResponse.json();
        testMessage = `Connected as: ${userData.data?.email || userData.email || "Unknown user"}`;
        console.log("Lawmatics API test successful:", testMessage);
      } else if (usersResponse.status === 404) {
        // Endpoint may not exist, try /events fallback
        console.log("Users/me endpoint not found, trying events fallback...");
        const eventsResponse = await fetch("https://api.lawmatics.com/v1/events?per_page=1", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${lawmaticsConnection.access_token}`,
            "Content-Type": "application/json",
          },
        });

        testStatus = eventsResponse.status;

        if (eventsResponse.ok) {
          testOk = true;
          testMessage = "API connection verified via events endpoint";
          console.log("Lawmatics API test successful via events endpoint");
        } else {
          const errorText = await eventsResponse.text();
          testMessage = `Events API failed: ${eventsResponse.status} - ${errorText.substring(0, 200)}`;
          console.error("Lawmatics events API test failed:", testMessage);
        }
      } else {
        const errorText = await usersResponse.text();
        testMessage = `API error: ${usersResponse.status} - ${errorText.substring(0, 200)}`;
        console.error("Lawmatics API test failed:", testMessage);
      }
    } catch (fetchError) {
      testMessage = `Network error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
      console.error("Lawmatics API test network error:", testMessage);
    }

    // Store test results
    await storeTestResult(serviceClient, testOk, testOk ? "" : testMessage);

    return new Response(JSON.stringify({ ok: testOk, status: testStatus, message: testMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in lawmatics-test:", error);
    return new Response(JSON.stringify({ 
      ok: false, 
      status: 500, 
      message: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function storeTestResult(supabase: any, ok: boolean, errorMessage: string) {
  const now = new Date().toISOString();
  
  await Promise.all([
    supabase.from("app_settings").upsert({ 
      key: "lawmatics_last_test_at", 
      value: now,
      updated_at: now 
    }, { onConflict: "key" }),
    supabase.from("app_settings").upsert({ 
      key: "lawmatics_last_test_ok", 
      value: ok ? "true" : "false",
      updated_at: now 
    }, { onConflict: "key" }),
    supabase.from("app_settings").upsert({ 
      key: "lawmatics_last_test_error", 
      value: errorMessage,
      updated_at: now 
    }, { onConflict: "key" }),
  ]);
}
