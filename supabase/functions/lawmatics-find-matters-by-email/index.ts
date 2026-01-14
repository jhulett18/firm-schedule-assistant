import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LAWMATICS_BASE_URL = "https://api.lawmatics.com";

interface LawmaticsMatter {
  id: string;
  title: string;
  status: string | null;
  practice_area: string | null;
  updated_at: string | null;
  contact_id: string | null;
}

function pickString(v: any): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

async function lawmaticsFetch(
  accessToken: string,
  method: string,
  path: string
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${LAWMATICS_BASE_URL}${path}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

async function lawmaticsJson(res: Response): Promise<{
  ok: boolean;
  status: number;
  json: any | null;
  excerpt: string;
}> {
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    excerpt: (text || "").slice(0, 500),
  };
}

/**
 * Parse matters from API response data array
 */
function parseMatters(rawData: any[]): LawmaticsMatter[] {
  const matters: LawmaticsMatter[] = [];
  
  for (const m of rawData) {
    const attrs = m?.attributes ?? m;
    const id = pickString(m?.id);
    if (!id) continue;

    matters.push({
      id,
      title:
        pickString(attrs?.case_title) ||
        pickString(attrs?.title) ||
        pickString(attrs?.name) ||
        `Matter ${id}`,
      status: pickString(attrs?.status) || pickString(attrs?.stage),
      practice_area: pickString(attrs?.practice_area) || pickString(attrs?.practice_type),
      updated_at: pickString(attrs?.updated_at) || pickString(attrs?.modified_at),
      contact_id: pickString(attrs?.contact_id) || pickString(attrs?.primary_contact_id),
    });
  }
  
  return matters;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "Valid email is required", matters: [], warnings: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Lawmatics] Searching prospects/matters directly for email:", email);

    // Get active Lawmatics connection
    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lawmaticsConnection?.access_token) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No Lawmatics connection configured", 
          matters: [],
          warnings: ["Lawmatics integration not connected"]
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = lawmaticsConnection.access_token;
    const allWarnings: string[] = [];
    const attempts: Array<{ endpoint: string; status: number; count: number; excerpt: string }> = [];
    let matters: LawmaticsMatter[] = [];

    // STEP 1: Search prospects endpoint directly by email
    try {
      const prospectsUrl = `/v1/prospects?search=${encodeURIComponent(email)}&per_page=50`;
      console.log("[Lawmatics] Searching prospects:", prospectsUrl);

      const prospectsRes = await lawmaticsFetch(accessToken, "GET", prospectsUrl);
      const prospectsResult = await lawmaticsJson(prospectsRes);
      
      const rawProspects: any[] = Array.isArray(prospectsResult.json?.data) 
        ? prospectsResult.json.data 
        : [];
      
      attempts.push({ 
        endpoint: prospectsUrl, 
        status: prospectsResult.status, 
        count: rawProspects.length,
        excerpt: prospectsResult.excerpt 
      });

      if (prospectsResult.ok && rawProspects.length > 0) {
        console.log(`[Lawmatics] /v1/prospects returned ${rawProspects.length} results`);
        
        // Log first result structure for debugging
        if (rawProspects.length > 0) {
          console.log("[Lawmatics] Sample prospect structure:", JSON.stringify(rawProspects[0], null, 2));
        }
        
        matters = parseMatters(rawProspects);
        console.log(`[Lawmatics] Parsed ${matters.length} matters from prospects`);
      } else if (prospectsResult.status === 404) {
        console.log("[Lawmatics] /v1/prospects returned 404, will try /v1/matters");
        allWarnings.push("/v1/prospects returned 404");
      } else if (!prospectsResult.ok) {
        console.warn(`[Lawmatics] /v1/prospects failed (${prospectsResult.status}):`, prospectsResult.excerpt);
        allWarnings.push(`/v1/prospects failed (${prospectsResult.status})`);
      } else {
        console.log("[Lawmatics] /v1/prospects returned 0 results");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allWarnings.push(`/v1/prospects exception: ${msg}`);
      console.error("[Lawmatics] /v1/prospects exception:", msg);
    }

    // STEP 2: If no matters found, try /v1/matters endpoint as fallback
    if (matters.length === 0) {
      try {
        const mattersUrl = `/v1/matters?search=${encodeURIComponent(email)}&per_page=50`;
        console.log("[Lawmatics] Searching matters fallback:", mattersUrl);

        const mattersRes = await lawmaticsFetch(accessToken, "GET", mattersUrl);
        const mattersResult = await lawmaticsJson(mattersRes);
        
        const rawMatters: any[] = Array.isArray(mattersResult.json?.data) 
          ? mattersResult.json.data 
          : [];
        
        attempts.push({ 
          endpoint: mattersUrl, 
          status: mattersResult.status, 
          count: rawMatters.length,
          excerpt: mattersResult.excerpt 
        });

        if (mattersResult.ok && rawMatters.length > 0) {
          console.log(`[Lawmatics] /v1/matters returned ${rawMatters.length} results`);
          
          // Log first result structure for debugging
          if (rawMatters.length > 0) {
            console.log("[Lawmatics] Sample matter structure:", JSON.stringify(rawMatters[0], null, 2));
          }
          
          matters = parseMatters(rawMatters);
          console.log(`[Lawmatics] Parsed ${matters.length} matters from /v1/matters`);
        } else if (mattersResult.status === 404) {
          console.log("[Lawmatics] /v1/matters returned 404");
          allWarnings.push("/v1/matters returned 404");
        } else if (!mattersResult.ok) {
          console.warn(`[Lawmatics] /v1/matters failed (${mattersResult.status}):`, mattersResult.excerpt);
          allWarnings.push(`/v1/matters failed (${mattersResult.status})`);
        } else {
          console.log("[Lawmatics] /v1/matters returned 0 results");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        allWarnings.push(`/v1/matters exception: ${msg}`);
        console.error("[Lawmatics] /v1/matters exception:", msg);
      }
    }

    // Sort by updated_at descending (most recent first)
    matters.sort((a, b) => {
      if (!a.updated_at && !b.updated_at) return 0;
      if (!a.updated_at) return 1;
      if (!b.updated_at) return -1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    console.log(`[Lawmatics] Returning ${matters.length} matters for email ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        matters, 
        attempts,
        warnings: allWarnings.length > 0 ? allWarnings : undefined
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("lawmatics-find-matters-by-email error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        matters: [],
        warnings: [`Unexpected error: ${error instanceof Error ? error.message : String(error)}`]
      }),
      {
        status: 200, // Non-fatal for UI
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
