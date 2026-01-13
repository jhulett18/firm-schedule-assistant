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
    excerpt: (text || "").slice(0, 300),
  };
}

/**
 * Fetch matters for a given contact ID with endpoint fallback.
 * Tries /v1/prospects first, then /v1/matters if 404.
 */
async function fetchMattersForContact(
  accessToken: string,
  contactId: string
): Promise<{ matters: LawmaticsMatter[]; warnings: string[] }> {
  const matters: LawmaticsMatter[] = [];
  const warnings: string[] = [];
  
  // ATTEMPT 1: Try /v1/prospects (preferred endpoint)
  try {
    const url1 = `/v1/prospects?filter_by=contact_id&filter_on=${contactId}&fields=case_title,status,practice_area,updated_at&per_page=50`;
    console.log("[Lawmatics] Fetching matters via /v1/prospects for contact:", contactId);
    
    const res1 = await lawmaticsFetch(accessToken, "GET", url1);
    const result1 = await lawmaticsJson(res1);
    
    if (result1.ok && result1.json) {
      const rawMatters: any[] = Array.isArray(result1.json?.data) ? result1.json.data : [];
      
      for (const m of rawMatters) {
        const attrs = m?.attributes ?? m;
        const id = pickString(m?.id);
        if (!id) continue;
        
        matters.push({
          id,
          title: pickString(attrs?.case_title) || pickString(attrs?.name) || pickString(attrs?.title) || `Matter ${id}`,
          status: pickString(attrs?.status) || pickString(attrs?.stage),
          practice_area: pickString(attrs?.practice_area) || pickString(attrs?.practice_type),
          updated_at: pickString(attrs?.updated_at) || pickString(attrs?.modified_at),
        });
      }
      
      console.log(`[Lawmatics] /v1/prospects returned ${matters.length} matters for contact ${contactId}`);
      return { matters, warnings };
    }
    
    // If 404, try fallback
    if (result1.status === 404) {
      warnings.push("/v1/prospects returned 404, trying /v1/matters fallback");
      console.log("[Lawmatics] /v1/prospects returned 404, trying /v1/matters fallback");
    } else if (!result1.ok) {
      warnings.push(`/v1/prospects failed (${result1.status}): ${result1.excerpt}`);
      console.warn("[Lawmatics] /v1/prospects failed:", result1.status, result1.excerpt);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`/v1/prospects exception: ${msg}`);
    console.warn("[Lawmatics] /v1/prospects exception:", msg);
  }
  
  // ATTEMPT 2: Fallback to /v1/matters
  try {
    const url2 = `/v1/matters?contact_id=${contactId}&per_page=50`;
    console.log("[Lawmatics] Fetching matters via /v1/matters fallback for contact:", contactId);
    
    const res2 = await lawmaticsFetch(accessToken, "GET", url2);
    const result2 = await lawmaticsJson(res2);
    
    if (result2.ok && result2.json) {
      const rawMatters: any[] = Array.isArray(result2.json?.data) ? result2.json.data : [];
      const existingIds = new Set(matters.map(m => m.id));
      
      for (const m of rawMatters) {
        const attrs = m?.attributes ?? m;
        const id = pickString(m?.id);
        if (!id || existingIds.has(id)) continue;
        
        matters.push({
          id,
          title: pickString(attrs?.name) || pickString(attrs?.case_title) || pickString(attrs?.title) || `Matter ${id}`,
          status: pickString(attrs?.status) || pickString(attrs?.stage),
          practice_area: pickString(attrs?.practice_area) || pickString(attrs?.practice_type),
          updated_at: pickString(attrs?.updated_at) || pickString(attrs?.modified_at),
        });
      }
      
      console.log(`[Lawmatics] /v1/matters returned ${rawMatters.length} matters for contact ${contactId}`);
    } else if (!result2.ok) {
      warnings.push(`/v1/matters fallback failed (${result2.status}): ${result2.excerpt}`);
      console.warn("[Lawmatics] /v1/matters fallback failed:", result2.status, result2.excerpt);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`/v1/matters exception: ${msg}`);
    console.warn("[Lawmatics] /v1/matters exception:", msg);
  }
  
  return { matters, warnings };
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

    console.log("Searching Lawmatics matters for email:", email);

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
    let matters: LawmaticsMatter[] = [];

    // STEP 1: Search for contact by email (contact-driven approach)
    let contactId: string | null = null;
    try {
      const contactRes = await lawmaticsFetch(
        accessToken,
        "GET",
        `/v1/contacts?search=${encodeURIComponent(email)}&per_page=10`
      );
      const { ok, status, json, excerpt } = await lawmaticsJson(contactRes);

      if (ok && json) {
        const contacts: any[] = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.contacts)
            ? json.contacts
            : [];

        // Find exact email match (case-insensitive)
        const normalizedEmail = email.toLowerCase();
        const exactMatch = contacts.find((c) => {
          const attrs = c?.attributes ?? c;
          const contactEmail = pickString(attrs?.email);
          return contactEmail?.toLowerCase() === normalizedEmail;
        });

        if (exactMatch) {
          contactId = pickString(exactMatch?.id ?? exactMatch?.data?.id);
          console.log("Found Lawmatics contact:", contactId);
        } else if (contacts.length > 0) {
          console.log(`Found ${contacts.length} contacts but no exact email match for ${email}`);
          allWarnings.push(`Found ${contacts.length} contacts but no exact email match`);
        } else {
          console.log("No contacts found for email:", email);
        }
      } else {
        allWarnings.push(`Contact search failed (${status}): ${excerpt}`);
        console.warn("Contact search failed:", status, excerpt);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allWarnings.push(`Contact search exception: ${msg}`);
      console.error("Error searching for contact:", msg);
    }

    // STEP 2: If contact found, fetch matters with fallback endpoint strategy
    if (contactId) {
      const { matters: contactMatters, warnings: fetchWarnings } = await fetchMattersForContact(accessToken, contactId);
      matters = contactMatters;
      allWarnings.push(...fetchWarnings);
    }

    // Sort by updated_at descending (most recent first)
    matters.sort((a, b) => {
      if (!a.updated_at && !b.updated_at) return 0;
      if (!a.updated_at) return 1;
      if (!b.updated_at) return -1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    console.log("Returning matters:", matters.length, "with warnings:", allWarnings.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        matters, 
        contactId,
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