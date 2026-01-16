import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeleteAccountResponse {
  success: boolean;
  error?: string;
}

function jsonResponse(status: number, body: DeleteAccountResponse) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method Not Allowed" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { success: false, error: "Unauthorized" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return jsonResponse(401, { success: false, error: "Unauthorized" });
  }

  const authUser = authData.user;

  const { data: internalUser, error: internalUserError } = await serviceClient
    .from("users")
    .select("id, role, company_id, email")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (internalUserError) {
    return jsonResponse(500, { success: false, error: "Failed to load user profile" });
  }

  if (!internalUser) {
    return jsonResponse(403, { success: false, error: "Only staff accounts can be deleted here" });
  }

  const { data: rolesData, error: rolesError } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", authUser.id);

  if (rolesError) {
    return jsonResponse(500, { success: false, error: "Failed to load user roles" });
  }

  const roles = (rolesData || []).map((r) => r.role);
  const isStaffOrAdmin = roles.includes("staff") || roles.includes("admin");
  const isOwner = internalUser.role === "Owner";

  if (!isStaffOrAdmin && !isOwner) {
    return jsonResponse(403, { success: false, error: "Account deletion is not available for this role" });
  }

  if (internalUser.company_id) {
    const { data: company, error: companyError } = await serviceClient
      .from("companies")
      .select("owner_id")
      .eq("id", internalUser.company_id)
      .maybeSingle();

    if (companyError) {
      return jsonResponse(500, { success: false, error: "Failed to verify company ownership" });
    }

    if (company?.owner_id === internalUser.id) {
      return jsonResponse(400, {
        success: false,
        error: "Transfer company ownership before deleting this account",
      });
    }
  }

  const meetingFilter = [
    `created_by_user_id.eq.${internalUser.id}`,
    `host_attorney_user_id.eq.${internalUser.id}`,
    `support_user_ids.cs.{${internalUser.id}}`,
    `participant_user_ids.cs.{${internalUser.id}}`,
  ].join(",");

  const { data: meetings, error: meetingError } = await serviceClient
    .from("meetings")
    .select("id, created_by_user_id, host_attorney_user_id, support_user_ids, participant_user_ids")
    .or(meetingFilter);

  if (meetingError) {
    return jsonResponse(500, { success: false, error: "Failed to load meetings for anonymization" });
  }

  for (const meeting of meetings || []) {
    const updates: Record<string, unknown> = {};

    if (meeting.created_by_user_id === internalUser.id) {
      updates.created_by_user_id = null;
    }
    if (meeting.host_attorney_user_id === internalUser.id) {
      updates.host_attorney_user_id = null;
    }
    if (Array.isArray(meeting.support_user_ids) && meeting.support_user_ids.includes(internalUser.id)) {
      updates.support_user_ids = meeting.support_user_ids.filter((id: string) => id !== internalUser.id);
    }
    if (Array.isArray(meeting.participant_user_ids) && meeting.participant_user_ids.includes(internalUser.id)) {
      updates.participant_user_ids = meeting.participant_user_ids.filter((id: string) => id !== internalUser.id);
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await serviceClient
        .from("meetings")
        .update(updates)
        .eq("id", meeting.id);

      if (updateError) {
        return jsonResponse(500, { success: false, error: "Failed to anonymize meetings" });
      }
    }
  }

  const cleanupSteps = [
    serviceClient.from("meeting_google_events").delete().eq("user_id", internalUser.id),
    serviceClient.from("calendar_connections").delete().eq("user_id", internalUser.id),
    serviceClient.from("notifications").delete().eq("user_id", internalUser.id),
    serviceClient.from("user_roles").delete().eq("user_id", authUser.id),
  ];

  const cleanupResults = await Promise.all(cleanupSteps);
  const cleanupError = cleanupResults.find((result) => result.error);
  if (cleanupError?.error) {
    return jsonResponse(500, { success: false, error: "Failed to remove related records" });
  }

  const { error: deleteUserError } = await serviceClient.from("users").delete().eq("id", internalUser.id);
  if (deleteUserError) {
    return jsonResponse(500, { success: false, error: "Failed to delete user profile" });
  }

  const { error: authDeleteError } = await serviceClient.auth.admin.deleteUser(authUser.id);
  if (authDeleteError) {
    return jsonResponse(500, { success: false, error: "Failed to delete auth account" });
  }

  await serviceClient.from("audit_logs").insert({
    action_type: "SettingsChange",
    meeting_id: null,
    details_json: {
      action: "account_deleted",
      user_id: internalUser.id,
      auth_user_id: authUser.id,
      email: internalUser.email,
      deleted_at: new Date().toISOString(),
    },
  });

  return jsonResponse(200, { success: true });
});
