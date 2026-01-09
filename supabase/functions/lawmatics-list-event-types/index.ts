import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_KEY = "event_types";
const CACHE_TTL_HOURS = 24;

// Robust name resolver - tries multiple field patterns
function resolveDisplayName(item: any): string {
  // Direct fields
  if (item.name && typeof item.name === "string") return item.name;
  if (item.title && typeof item.title === "string") return item.title;
  if (item.label && typeof item.label === "string") return item.label;
  if (item.display_name && typeof item.display_name === "string") return item.display_name;
  
  // JSON:API style nested attributes
  if (item.attributes) {
    if (item.attributes.name && typeof item.attributes.name === "string") return item.attributes.name;
    if (item.attributes.title && typeof item.attributes.title === "string") return item.attributes.title;
    if (item.attributes.label && typeof item.attributes.label === "string") return item.attributes.label;
  }
  
  // Translations - prefer English
  if (item.translations?.en) {
    if (item.translations.en.name && typeof item.translations.en.name === "string") return item.translations.en.name;
    if (item.translations.en.title && typeof item.translations.en.title === "string") return item.translations.en.title;
  }
  
  // Fallback
  return `Appointment Type ${item.id}`;
}

// Extract array from various response shapes
function extractItemsArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.appointment_types)) return data.appointment_types;
  if (Array.isArray(data.event_types)) return data.event_types;
  return [];
}

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

    // Parse request body
    let body: { forceRefresh?: boolean; debug?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON, use defaults
    }
    
    // Also check query param for debug
    const url = new URL(req.url);
    const debugMode = body.debug === true || url.searchParams.get("debug") === "1";
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
          console.log("Returning cached appointment types, age:", hoursSinceFetch.toFixed(1), "hours");
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

    // Try multiple endpoint variations - appointment_types first
    const endpoints = [
      "https://api.lawmatics.com/v1/appointment_types",
      "https://api.lawmatics.com/v1/appointment-types",
      "https://api.lawmatics.com/v1/event_types",
      "https://api.lawmatics.com/v1/event-types",
      "https://api.lawmatics.com/v1/events/types",
    ];

    let allItems: { id: string; name: string }[] = [];
    let fetchedSuccessfully = false;
    let lastError = "";
    let debugInfo: any = null;
    let sampleRaw: any[] = [];

    for (const baseEndpoint of endpoints) {
      console.log("Trying endpoint:", baseEndpoint);
      let page = 1;
      let pageItems: any[] = [];
      let hasMorePages = true;
      
      try {
        // Pagination loop
        while (hasMorePages) {
          const endpoint = `${baseEndpoint}?per_page=200&page=${page}`;
          console.log(`Fetching page ${page}:`, endpoint);
          
          const response = await fetch(endpoint, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${lawmaticsConnection.access_token}`,
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            const data = await response.json();
            const rawItems = extractItemsArray(data);
            
            // Store samples for debug on first page
            if (page === 1 && debugMode && rawItems.length > 0) {
              sampleRaw = rawItems.slice(0, 3);
            }
            
            if (rawItems.length === 0) {
              hasMorePages = false;
            } else {
              pageItems = pageItems.concat(rawItems);
              page++;
              // Safety limit
              if (page > 50) hasMorePages = false;
            }
          } else if (response.status === 401 || response.status === 403) {
            lastError = "Lawmatics token invalid - please reconnect";
            hasMorePages = false;
            break;
          } else if (response.status === 404 || response.status === 405) {
            // This endpoint doesn't exist, try next
            hasMorePages = false;
            break;
          } else {
            const errorText = await response.text();
            lastError = `API error: ${response.status} - ${errorText.slice(0, 100)}`;
            hasMorePages = false;
          }
        }
        
        // If we got any items from this endpoint, use them
        if (pageItems.length > 0) {
          // Normalize items with robust name resolution
          allItems = pageItems.map((item: any) => ({
            id: String(item.id),
            name: resolveDisplayName(item),
          }));
          fetchedSuccessfully = true;
          console.log(`Successfully fetched ${allItems.length} appointment types from ${baseEndpoint}`);
          
          // Build debug info if requested
          if (debugMode) {
            const sampleKeys = sampleRaw.length > 0 
              ? [...new Set(sampleRaw.flatMap(item => Object.keys(item)))]
              : [];
            
            debugInfo = {
              debug: true,
              endpoint_used: baseEndpoint,
              total_pages: page - 1,
              sample_raw: sampleRaw,
              sample_keys: sampleKeys,
              sample_resolved: sampleRaw.map(item => ({
                id: item.id,
                resolved_name: resolveDisplayName(item),
              })),
            };
          }
          
          break;
        }
      } catch (err) {
        lastError = `Network error: ${err instanceof Error ? err.message : String(err)}`;
        console.error("Error fetching from", baseEndpoint, lastError);
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
        data: { items: allItems },
        fetched_at: now,
      }, { onConflict: "key" });

    const response: any = {
      items: allItems,
      fetched_at: now,
      cached: false,
      ...(lastError && !fetchedSuccessfully ? { warning: lastError } : {}),
    };
    
    // Include debug info if requested
    if (debugInfo) {
      Object.assign(response, debugInfo);
    }

    return new Response(JSON.stringify(response), {
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