import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Local helper since we can't import from shared in a reliable way
async function lawmaticsFetch(
  accessToken: string,
  method: string,
  path: string,
  body?: any
): Promise<Response> {
  const url = path.startsWith("http") ? path : `https://api.lawmatics.com${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(url, init);
}

function pickString(v: any): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

interface LawmaticsUser {
  id: string;
  email: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  timezone: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get admin Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get Lawmatics connection
    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lawmaticsConnection?.access_token) {
      return new Response(JSON.stringify({ error: "No Lawmatics connection" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all users with pagination
    const allUsers: LawmaticsUser[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const res = await lawmaticsFetch(
        lawmaticsConnection.access_token,
        "GET",
        `/v1/users?page=${page}&per_page=${perPage}`
      );
      
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        console.error("[Lawmatics] list users failed:", res.status, text.slice(0, 300));
        
        // Check for token expiration
        if (res.status === 401 || res.status === 403) {
          return new Response(JSON.stringify({ 
            error: "Lawmatics token expired",
            reconnectRequired: true 
          }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        return new Response(JSON.stringify({ 
          error: `Lawmatics API error: ${res.status}`,
          excerpt: text.slice(0, 200)
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Parse users - handle both {data:[...]} and array responses
      const rawUsers: any[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.users)
          ? json.users
          : Array.isArray(json)
            ? json
            : [];

      if (rawUsers.length === 0) break;

      for (const u of rawUsers) {
        const attrs = u?.attributes ?? u;
        allUsers.push({
          id: pickString(u?.id) || "",
          email: pickString(attrs?.email),
          name: pickString(attrs?.name) || pickString(attrs?.full_name),
          firstName: pickString(attrs?.first_name),
          lastName: pickString(attrs?.last_name),
          timezone: pickString(attrs?.time_zone ?? attrs?.timezone ?? attrs?.timeZone),
        });
      }

      // Check if we got a full page (might be more)
      if (rawUsers.length < perPage) break;
      page++;

      // Safety limit
      if (page > 10) break;
    }

    console.log(`[Lawmatics] Fetched ${allUsers.length} users`);

    // Cache in lawmatics_reference_data
    await supabase
      .from("lawmatics_reference_data")
      .upsert({
        key: "users",
        data: allUsers,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "key" });

    return new Response(JSON.stringify({
      ok: true,
      users: allUsers,
      count: allUsers.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in lawmatics-list-users:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
