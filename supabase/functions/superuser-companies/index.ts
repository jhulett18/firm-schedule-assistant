import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function ensureSuperuser(serviceClient: ReturnType<typeof createClient>, authUserId: string) {
  const { data, error } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", authUserId)
    .eq("role", "superuser")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "Failed to verify role" };
  }
  if (!data) {
    return { ok: false, error: "Superuser access required" };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const roleCheck = await ensureSuperuser(serviceClient, authData.user.id);
  if (!roleCheck.ok) {
    return jsonResponse(403, { error: roleCheck.error });
  }

  if (req.method === "GET") {
    const { data, error } = await serviceClient
      .from("companies")
      .select("id, name, registration_code, invite_code, owner_id, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return jsonResponse(500, { error: "Failed to fetch companies" });
    }
    return jsonResponse(200, { success: true, companies: data });
  }

  if (req.method === "POST") {
    let body: { name?: string } = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body" });
    }

    const name = body.name?.trim();
    if (!name) {
      return jsonResponse(400, { error: "Missing company name" });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const registrationCode = generateCode();
      const inviteCode = generateCode();
      const { data, error } = await serviceClient
        .from("companies")
        .insert({
          name,
          registration_code: registrationCode,
          invite_code: inviteCode,
        })
        .select("id, name, registration_code, invite_code, owner_id, created_at")
        .single();

      if (!error) {
        return jsonResponse(200, { success: true, company: data });
      }

      const message = error?.message || "";
      const isDuplicate = message.toLowerCase().includes("duplicate");
      if (!isDuplicate) {
        return jsonResponse(500, { error: "Failed to create company" });
      }
    }

    return jsonResponse(500, { error: "Unable to generate unique company codes" });
  }

  if (req.method === "PATCH") {
    let body: { companyId?: string; regenerate?: "both" | "registration" | "invite" } = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body" });
    }

    const companyId = body.companyId;
    const regenerate = body.regenerate || "both";
    if (!companyId) {
      return jsonResponse(400, { error: "Missing companyId" });
    }

    const updates: Record<string, string> = {};
    if (regenerate === "both" || regenerate === "registration") {
      updates.registration_code = generateCode();
    }
    if (regenerate === "both" || regenerate === "invite") {
      updates.invite_code = generateCode();
    }

    const { data, error } = await serviceClient
      .from("companies")
      .update(updates)
      .eq("id", companyId)
      .select("id, name, registration_code, invite_code, owner_id, created_at")
      .single();

    if (error) {
      return jsonResponse(500, { error: "Failed to update company codes" });
    }

    return jsonResponse(200, { success: true, company: data });
  }

  return jsonResponse(405, { error: "Method Not Allowed" });
});
