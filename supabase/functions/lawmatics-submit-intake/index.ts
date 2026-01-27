import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LAWMATICS_BASE_URL = "https://api.lawmatics.com";

interface IntakeData {
  // Contact info (Page 1)
  first_name: string;
  middle_name?: string;
  last_name: string;
  phone?: string;
  email: string;
  is_existing_client?: string;
  next_steps_contact?: string;
  notes_message?: string;
  
  // Intake details (Page 2)
  preferred_name?: string;
  gender?: string;
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  practice_area_id?: string;
  source_id?: string;
  is_second_client?: string;
  additional_people?: string;
  matter_description?: string;
  intake_notes?: string;
  next_steps_intake?: string;
}

async function lawmaticsFetch(
  accessToken: string,
  method: string,
  path: string,
  body?: any
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${LAWMATICS_BASE_URL}${path}`;
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
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const data: IntakeData = await req.json();
    console.log("Received intake data:", JSON.stringify({
      ...data,
      email: data.email ? data.email.replace(/(.{2})(.*)(@.*)/, "$1***$3") : null,
    }));

    // Validate required fields
    if (!data.first_name?.trim()) {
      return new Response(
        JSON.stringify({ error: "First name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!data.last_name?.trim()) {
      return new Response(
        JSON.stringify({ error: "Last name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!data.email?.trim()) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Lawmatics connection
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
    const results: {
      contact: { id: string | null; created: boolean; error?: string };
      matter: { id: string | null; created: boolean; error?: string };
    } = {
      contact: { id: null, created: false },
      matter: { id: null, created: false },
    };

    // Step 1: Find or create contact
    console.log("Step 1: Finding or creating contact...");
    
    // Search for existing contact
    const searchRes = await lawmaticsFetch(
      accessToken,
      "GET",
      `/v1/contacts?search=${encodeURIComponent(data.email)}&per_page=10`
    );
    const searchText = await searchRes.text();
    let searchJson: any = null;
    try {
      searchJson = searchText ? JSON.parse(searchText) : null;
    } catch {
      searchJson = null;
    }

    let contactId: string | null = null;

    if (searchRes.ok) {
      const contacts: any[] = Array.isArray(searchJson?.data)
        ? searchJson.data
        : Array.isArray(searchJson?.contacts)
          ? searchJson.contacts
          : [];

      const normalizedEmail = data.email.toLowerCase();
      const match = contacts.find((c) => {
        const attrs = c?.attributes ?? c;
        return pickString(attrs?.email)?.toLowerCase() === normalizedEmail;
      });

      if (match) {
        contactId = String(match?.id ?? match?.data?.id ?? "");
        results.contact = { id: contactId, created: false };
        console.log("Found existing contact:", contactId);
      }
    }

    // Create new contact if not found
    if (!contactId) {
      const contactPayload: Record<string, any> = {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        email: data.email.trim(),
      };

      if (data.middle_name?.trim()) contactPayload.middle_name = data.middle_name.trim();
      if (data.phone?.trim()) contactPayload.phone = data.phone.trim();
      if (data.preferred_name?.trim()) contactPayload.preferred_name = data.preferred_name.trim();
      if (data.gender?.trim()) contactPayload.gender = data.gender.trim();
      if (data.address_line_1?.trim()) contactPayload.address_line_1 = data.address_line_1.trim();
      if (data.address_line_2?.trim()) contactPayload.address_line_2 = data.address_line_2.trim();
      if (data.city?.trim()) contactPayload.city = data.city.trim();
      if (data.state?.trim()) contactPayload.state = data.state.trim();
      if (data.zip?.trim()) contactPayload.zip = data.zip.trim();
      if (data.source_id?.trim()) contactPayload.source_id = data.source_id.trim();

      console.log("Creating contact with payload:", JSON.stringify({
        ...contactPayload,
        email: contactPayload.email?.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
      }));

      const createRes = await lawmaticsFetch(accessToken, "POST", "/v1/contacts", contactPayload);
      const createText = await createRes.text();
      let createJson: any = null;
      try {
        createJson = createText ? JSON.parse(createText) : null;
      } catch {
        createJson = null;
      }

      if (createRes.ok) {
        contactId = String(createJson?.data?.id ?? createJson?.id ?? "");
        results.contact = { id: contactId, created: true };
        console.log("Created contact:", contactId);
      } else {
        console.error("Failed to create contact:", createRes.status, createText.slice(0, 500));
        results.contact = { id: null, created: false, error: createText.slice(0, 200) };
      }
    }

    // Step 2: Create matter/prospect
    console.log("Step 2: Creating matter/prospect...");

    // Combine all notes
    const notesParts: string[] = [];
    if (data.notes_message?.trim()) notesParts.push(`Message: ${data.notes_message.trim()}`);
    if (data.additional_people?.trim()) notesParts.push(`Additional People (Conflict Check): ${data.additional_people.trim()}`);
    if (data.matter_description?.trim()) notesParts.push(`Matter Description: ${data.matter_description.trim()}`);
    if (data.intake_notes?.trim()) notesParts.push(`Intake Notes: ${data.intake_notes.trim()}`);
    if (data.is_existing_client?.trim()) notesParts.push(`Is Existing Client: ${data.is_existing_client.trim()}`);
    if (data.is_second_client?.trim()) notesParts.push(`Is Second Client: ${data.is_second_client.trim()}`);

    const matterPayload: Record<string, any> = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      email: data.email.trim(),
    };

    if (contactId) matterPayload.contact_id = contactId;
    if (data.matter_description?.trim()) matterPayload.case_title = data.matter_description.trim().slice(0, 100);
    if (data.practice_area_id?.trim()) matterPayload.practice_area_id = data.practice_area_id.trim();
    if (notesParts.length > 0) matterPayload.notes = notesParts.join("\n\n");
    
    // Use the final next steps value (intake overrides contact)
    const nextSteps = data.next_steps_intake?.trim() || data.next_steps_contact?.trim();
    if (nextSteps) matterPayload.stage_id = nextSteps;

    console.log("Creating matter with payload fields:", Object.keys(matterPayload));

    // Try /v1/prospects first
    let matterRes = await lawmaticsFetch(accessToken, "POST", "/v1/prospects", matterPayload);
    let matterText = await matterRes.text();
    let matterJson: any = null;
    try {
      matterJson = matterText ? JSON.parse(matterText) : null;
    } catch {
      matterJson = null;
    }

    // If prospects fails, try /v1/matters
    if (!matterRes.ok) {
      console.log("Prospects endpoint failed, trying /v1/matters...");
      matterRes = await lawmaticsFetch(accessToken, "POST", "/v1/matters", matterPayload);
      matterText = await matterRes.text();
      try {
        matterJson = matterText ? JSON.parse(matterText) : null;
      } catch {
        matterJson = null;
      }
    }

    if (matterRes.ok) {
      const matterId = String(matterJson?.data?.id ?? matterJson?.id ?? "");
      results.matter = { id: matterId, created: true };
      console.log("Created matter:", matterId);
    } else {
      console.error("Failed to create matter:", matterRes.status, matterText.slice(0, 500));
      results.matter = { id: null, created: false, error: matterText.slice(0, 200) };
    }

    // Determine overall success
    const success = results.contact.id !== null || results.matter.id !== null;

    return new Response(
      JSON.stringify({
        success,
        contact_id: results.contact.id,
        contact_created: results.contact.created,
        matter_id: results.matter.id,
        matter_created: results.matter.created,
        errors: {
          contact: results.contact.error,
          matter: results.matter.error,
        },
      }),
      { 
        status: success ? 200 : 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
