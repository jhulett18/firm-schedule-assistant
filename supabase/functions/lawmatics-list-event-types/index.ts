import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_KEY = "event_types";
const CACHE_TTL_HOURS = 24;

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

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if force refresh requested
    let body: { forceRefresh?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON, use defaults
    }
    const forceRefresh = body.forceRefresh === true;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const { data: cached } = await serviceClient
        .from("lawmatics_reference_data")
        .select("data, fetched_at")
        .eq("key", CACHE_KEY)
        .maybeSingle();

      if (cached?.fetched_at) {
        const cachedTime = new Date(cached.fetched_at).getTime();
        const now = Date.now();
        const hoursSinceFetch = (now - cachedTime) / (1000 * 60 * 60);

        if (hoursSinceFetch < CACHE_TTL_HOURS && cached.data?.items) {
          console.log("Returning cached event types, age:", hoursSinceFetch.toFixed(1), "hours");
          return new Response(JSON.stringify({
            items: cached.data.items,
            fetched_at: cached.fetched_at,
            cached: true,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Fetch Lawmatics connection
    const { data: lawmaticsConnection } = await serviceClient
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lawmaticsConnection?.access_token) {
      return new Response(JSON.stringify({ 
        error: "No Lawmatics connection found",
        items: [],
        fetched_at: null,
        cached: false,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try multiple endpoint variations
    const endpoints = [
      "https://api.lawmatics.com/v1/event_types?per_page=200",
      "https://api.lawmatics.com/v1/event-types?per_page=200",
      "https://api.lawmatics.com/v1/events/types?per_page=200",
    ];

    let items: { id: string; name: string }[] = [];
    let fetchedSuccessfully = false;
    let lastError = "";

    for (const endpoint of endpoints) {
      console.log("Trying endpoint:", endpoint);
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${lawmaticsConnection.access_token}`,
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const data = await response.json();
          // Normalize response - handle different response structures
          const rawItems = data.data || data.items || data || [];
          items = Array.isArray(rawItems) 
            ? rawItems.map((item: any) => ({
                id: String(item.id),
                name: item.name || item.title || `Event Type ${item.id}`,
              }))
            : [];
          fetchedSuccessfully = true;
          console.log("Successfully fetched", items.length, "event types from", endpoint);
          break;
        } else if (response.status === 401 || response.status === 403) {
          lastError = "Lawmatics token invalid - please reconnect";
          break; // Don't try other endpoints on auth errors
        } else if (response.status !== 404) {
          lastError = `API error: ${response.status}`;
        }
      } catch (err) {
        lastError = `Network error: ${err instanceof Error ? err.message : String(err)}`;
        console.error("Error fetching from", endpoint, lastError);
      }
    }

    if (!fetchedSuccessfully && lastError.includes("token invalid")) {
      return new Response(JSON.stringify({ 
        error: lastError,
        items: [],
        fetched_at: null,
        cached: false,
        reconnectRequired: true,
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store in cache
    const now = new Date().toISOString();
    await serviceClient
      .from("lawmatics_reference_data")
      .upsert({
        key: CACHE_KEY,
        data: { items },
        fetched_at: now,
      }, { onConflict: "key" });

    return new Response(JSON.stringify({
      items,
      fetched_at: now,
      cached: false,
      ...(lastError && !fetchedSuccessfully ? { warning: lastError } : {}),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in lawmatics-list-event-types:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
      items: [],
      fetched_at: null,
      cached: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
