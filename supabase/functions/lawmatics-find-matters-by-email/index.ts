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
        JSON.stringify({ success: false, error: "Valid email is required", matters: [] }),
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
          matters: [] 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = lawmaticsConnection.access_token;
    const matters: LawmaticsMatter[] = [];

    // Step 1: Search for contact by email
    let contactId: string | null = null;
    try {
      const contactRes = await lawmaticsFetch(
        accessToken,
        "GET",
        `/v1/contacts?search=${encodeURIComponent(email)}&per_page=10`
      );
      const { ok, json } = await lawmaticsJson(contactRes);

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
        }
      }
    } catch (err) {
      console.error("Error searching for contact:", err);
    }

    // Step 2: If we found a contact, search for matters (prospects) by contact_id
    // IMPORTANT: Lawmatics uses /v1/prospects endpoint for matters, NOT /v1/matters
    if (contactId) {
      try {
        const mattersRes = await lawmaticsFetch(
          accessToken,
          "GET",
          `/v1/prospects?filter_by=contact_id&filter_on=${contactId}&fields=case_title,status,practice_area,updated_at&per_page=50`
        );
        const { ok, json } = await lawmaticsJson(mattersRes);

        if (ok && json) {
          const rawMatters: any[] = Array.isArray(json?.data) ? json.data : [];

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

          console.log(`Found ${matters.length} matters for contact ${contactId}`);
        }
      } catch (err) {
        console.error("Error fetching matters by contact:", err);
      }
    }

    // Step 3: Also do a direct search by first_name/last_name or email in case there are matters not linked via contact_id
    if (matters.length === 0) {
      try {
        // Try searching prospects by email-like pattern using first_name filter (Lawmatics may match email in name fields)
        const searchRes = await lawmaticsFetch(
          accessToken,
          "GET",
          `/v1/prospects?filter_by=email&filter_on=${encodeURIComponent(email)}&fields=case_title,status,practice_area,updated_at&per_page=20`
        );
        const { ok, json } = await lawmaticsJson(searchRes);

        if (ok && json) {
          const rawMatters: any[] = Array.isArray(json?.data) ? json.data : [];
          const existingIds = new Set(matters.map((m) => m.id));

          for (const m of rawMatters) {
            const attrs = m?.attributes ?? m;
            const id = pickString(m?.id);
            if (!id || existingIds.has(id)) continue;

            matters.push({
              id,
              title: pickString(attrs?.case_title) || pickString(attrs?.name) || pickString(attrs?.title) || `Matter ${id}`,
              status: pickString(attrs?.status) || pickString(attrs?.stage),
              practice_area: pickString(attrs?.practice_area) || pickString(attrs?.practice_type),
              updated_at: pickString(attrs?.updated_at) || pickString(attrs?.modified_at),
            });
          }

          console.log(`Direct search found additional ${rawMatters.length} matters`);
        }
      } catch (err) {
        console.error("Error doing direct matter search:", err);
      }
    }

    // Sort by updated_at descending (most recent first)
    matters.sort((a, b) => {
      if (!a.updated_at && !b.updated_at) return 0;
      if (!a.updated_at) return 1;
      if (!b.updated_at) return -1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    console.log("Returning matters:", matters.length);

    return new Response(
      JSON.stringify({ success: true, matters, contactId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("lawmatics-find-matters-by-email error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        matters: [],
      }),
      {
        status: 200, // Non-fatal for UI
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
