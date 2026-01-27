import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LAWMATICS_BASE_URL = "https://api.lawmatics.com";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Lawmatics connection (first available)
    const { data: connection, error: connError } = await supabase
      .from("lawmatics_connections")
      .select("access_token, company_id")
      .limit(1)
      .single();

    if (connError || !connection) {
      console.error("No Lawmatics connection found:", connError);
      return new Response(
        JSON.stringify({ error: "No Lawmatics connection configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = connection.access_token;
    const cacheKey = `sources_${connection.company_id || "default"}`;

    // Check cache first (valid for 1 hour)
    const { data: cached } = await supabase
      .from("lawmatics_reference_data")
      .select("data, fetched_at")
      .eq("key", cacheKey)
      .single();

    const cacheAge = cached?.fetched_at
      ? Date.now() - new Date(cached.fetched_at).getTime()
      : Infinity;
    const ONE_HOUR = 60 * 60 * 1000;

    if (cached && cacheAge < ONE_HOUR) {
      console.log("Returning cached sources");
      return new Response(
        JSON.stringify({ items: cached.data, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch from Lawmatics API - try multiple possible endpoints
    console.log("Fetching sources from Lawmatics...");
    
    let items: Array<{ id: string; name: string }> = [];
    
    // Try /v1/sources first
    let res = await fetch(`${LAWMATICS_BASE_URL}/v1/sources`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      // Try /v1/referral_sources as fallback
      console.log("Trying /v1/referral_sources endpoint...");
      res = await fetch(`${LAWMATICS_BASE_URL}/v1/referral_sources`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      console.error("Lawmatics API error:", res.status, text.slice(0, 500));
      // Return empty array with fallback options
      items = [
        { id: "google", name: "Google Search" },
        { id: "referral", name: "Referral" },
        { id: "social", name: "Social Media" },
        { id: "website", name: "Website" },
        { id: "other", name: "Other" },
      ];
    } else {
      // Parse response - handle various formats
      const rawItems: any[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.sources)
          ? json.sources
          : Array.isArray(json?.referral_sources)
            ? json.referral_sources
            : Array.isArray(json)
              ? json
              : [];

      items = rawItems.map((item: any) => {
        const attrs = item?.attributes ?? item;
        return {
          id: String(item?.id ?? attrs?.id ?? ""),
          name: String(attrs?.name ?? attrs?.title ?? ""),
        };
      }).filter((item) => item.id && item.name);
    }

    console.log(`Found ${items.length} sources`);

    // Update cache
    await supabase
      .from("lawmatics_reference_data")
      .upsert({
        key: cacheKey,
        data: items,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "key" });

    return new Response(
      JSON.stringify({ items, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
