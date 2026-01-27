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
    const cacheKey = `stages_${connection.company_id || "default"}`;

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
      console.log("Returning cached stages");
      return new Response(
        JSON.stringify({ items: cached.data, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch from Lawmatics API - try pipelines/stages
    console.log("Fetching stages from Lawmatics...");
    
    let items: Array<{ id: string; name: string }> = [];
    
    // Try /v1/pipelines first to get stages
    let res = await fetch(`${LAWMATICS_BASE_URL}/v1/pipelines`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (res.ok) {
      // Parse pipelines and extract stages
      const pipelines: any[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.pipelines)
          ? json.pipelines
          : Array.isArray(json)
            ? json
            : [];

      for (const pipeline of pipelines) {
        const attrs = pipeline?.attributes ?? pipeline;
        const stages = attrs?.stages ?? attrs?.pipeline_stages ?? [];
        
        if (Array.isArray(stages)) {
          for (const stage of stages) {
            const stageAttrs = stage?.attributes ?? stage;
            items.push({
              id: String(stage?.id ?? stageAttrs?.id ?? ""),
              name: String(stageAttrs?.name ?? stageAttrs?.title ?? ""),
            });
          }
        }
      }
    }

    // If no stages found, try /v1/stages directly
    if (items.length === 0) {
      console.log("Trying /v1/stages endpoint...");
      res = await fetch(`${LAWMATICS_BASE_URL}/v1/stages`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      const stagesText = await res.text();
      let stagesJson: any = null;
      try {
        stagesJson = stagesText ? JSON.parse(stagesText) : null;
      } catch {
        stagesJson = null;
      }

      if (res.ok) {
        const rawItems: any[] = Array.isArray(stagesJson?.data)
          ? stagesJson.data
          : Array.isArray(stagesJson?.stages)
            ? stagesJson.stages
            : Array.isArray(stagesJson)
              ? stagesJson
              : [];

        items = rawItems.map((item: any) => {
          const attrs = item?.attributes ?? item;
          return {
            id: String(item?.id ?? attrs?.id ?? ""),
            name: String(attrs?.name ?? attrs?.title ?? ""),
          };
        }).filter((item) => item.id && item.name);
      }
    }

    // If still no stages, provide fallback options
    if (items.length === 0) {
      console.log("Using fallback stages");
      items = [
        { id: "new_lead", name: "New Lead" },
        { id: "contacted", name: "Contacted" },
        { id: "consultation_scheduled", name: "Consultation Scheduled" },
        { id: "follow_up", name: "Follow Up" },
        { id: "retained", name: "Retained" },
        { id: "closed", name: "Closed" },
      ];
    }

    // Filter out duplicates and empty items
    items = items.filter((item, index, self) => 
      item.id && item.name && 
      index === self.findIndex(t => t.id === item.id)
    );

    console.log(`Found ${items.length} stages`);

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
