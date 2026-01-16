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

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
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

  let body: { action?: string; companyId?: string; userId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON in request body" });
  }

  const action = body.action;
  if (!action) {
    return jsonResponse(400, { error: "Missing action" });
  }

  if (action === "list") {
    if (!body.companyId) {
      return jsonResponse(400, { error: "Missing companyId" });
    }

    const { data, error } = await serviceClient
      .from("users")
      .select("id, name, email, role, active, approved, approved_at, approved_by, company_id")
      .eq("company_id", body.companyId)
      .order("approved", { ascending: true })
      .order("name");

    if (error) {
      return jsonResponse(500, { error: "Failed to fetch users" });
    }
    return jsonResponse(200, { success: true, users: data });
  }

  if (action === "approve" || action === "reset_approval") {
    const userId = body.userId;
    if (!userId) {
      return jsonResponse(400, { error: "Missing userId" });
    }

    const { data: internalUser, error: internalUserError } = await serviceClient
      .from("users")
      .select("id")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (internalUserError || !internalUser) {
      return jsonResponse(500, { error: "Failed to resolve approver" });
    }

    const updates =
      action === "approve"
        ? {
            approved: true,
            approved_by: internalUser.id,
            approved_at: new Date().toISOString(),
          }
        : {
            approved: false,
            approved_by: null,
            approved_at: null,
          };

    const { data, error } = await serviceClient
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select("id, name, email, role, active, approved, approved_at, approved_by, company_id")
      .single();

    if (error) {
      return jsonResponse(500, { error: "Failed to update approval status" });
    }

    return jsonResponse(200, { success: true, user: data });
  }

  return jsonResponse(400, { error: "Unsupported action" });
});
