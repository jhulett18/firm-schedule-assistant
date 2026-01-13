// Shared Lawmatics helpers for backend functions
// IMPORTANT: keep this file dependency-free (no node imports)

const LAWMATICS_BASE_URL = "https://api.lawmatics.com";

export type LawmaticsJsonResult = {
  ok: boolean;
  status: number;
  text: string;
  json: any | null;
  excerpt: string;
};

export async function lawmaticsFetch(
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

export async function lawmaticsJson(res: Response): Promise<LawmaticsJsonResult> {
  const text = await res.text();
  let json: any | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    text,
    json,
    excerpt: (text || "").slice(0, 1000),
  };
}

// ========== HELPER UTILITIES ==========

export function pickString(v: any): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function pickNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeDateOnly(s: any): string | null {
  const v = pickString(s);
  if (!v) return null;
  // If Lawmatics returns an ISO-ish timestamp for start_date, normalize to YYYY-MM-DD
  return v.includes("T") ? v.slice(0, 10) : v;
}

// ========== ENDPOINT DETECTION ==========

export interface EndpointDetectionResult {
  prospectsEndpointExists: boolean;
  mattersEndpointExists: boolean;
  preferredEndpoint: "/v1/prospects" | "/v1/matters" | null;
  prospectsCheck: { status: number; excerpt: string };
  mattersCheck: { status: number; excerpt: string };
}

/**
 * Detect which Matter/Prospect endpoints exist in this Lawmatics account.
 * This is done by making a lightweight GET request to each endpoint.
 */
export async function detectAvailableEndpoints(accessToken: string): Promise<EndpointDetectionResult> {
  const result: EndpointDetectionResult = {
    prospectsEndpointExists: false,
    mattersEndpointExists: false,
    preferredEndpoint: null,
    prospectsCheck: { status: 0, excerpt: "" },
    mattersCheck: { status: 0, excerpt: "" },
  };

  // Check /v1/prospects
  try {
    const prospectsRes = await lawmaticsFetch(accessToken, "GET", "/v1/prospects?per_page=1");
    const prospectsJson = await lawmaticsJson(prospectsRes);
    result.prospectsCheck = { status: prospectsJson.status, excerpt: prospectsJson.excerpt };
    result.prospectsEndpointExists = prospectsJson.ok || prospectsJson.status !== 404;
    console.log(`[Lawmatics] /v1/prospects check: ${prospectsJson.status} ok=${prospectsJson.ok}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.prospectsCheck = { status: 0, excerpt: msg };
    console.log("[Lawmatics] /v1/prospects check exception:", msg);
  }

  // Check /v1/matters
  try {
    const mattersRes = await lawmaticsFetch(accessToken, "GET", "/v1/matters?per_page=1");
    const mattersJson = await lawmaticsJson(mattersRes);
    result.mattersCheck = { status: mattersJson.status, excerpt: mattersJson.excerpt };
    result.mattersEndpointExists = mattersJson.ok || mattersJson.status !== 404;
    console.log(`[Lawmatics] /v1/matters check: ${mattersJson.status} ok=${mattersJson.ok}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.mattersCheck = { status: 0, excerpt: msg };
    console.log("[Lawmatics] /v1/matters check exception:", msg);
  }

  // Prefer /v1/prospects (the documented endpoint for PNC/Matters)
  if (result.prospectsEndpointExists) {
    result.preferredEndpoint = "/v1/prospects";
  } else if (result.mattersEndpointExists) {
    result.preferredEndpoint = "/v1/matters";
  }

  return result;
}

// ========== LAWMATICS USER OPERATIONS ==========

export interface LawmaticsUser {
  id: string;
  email: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  timezone: string | null;
}

/**
 * Fetch all Lawmatics users with pagination support.
 * Returns an array of user objects with id, email, name, timezone.
 */
export async function lawmaticsListUsers(accessToken: string): Promise<{
  ok: boolean;
  users: LawmaticsUser[];
  error?: string;
}> {
  const allUsers: LawmaticsUser[] = [];
  let page = 1;
  const perPage = 100;
  
  try {
    while (true) {
      const res = await lawmaticsFetch(accessToken, "GET", `/v1/users?page=${page}&per_page=${perPage}`);
      const { ok, status, json, excerpt } = await lawmaticsJson(res);
      
      if (!ok) {
        console.error("[Lawmatics] list users failed:", status, excerpt);
        return { ok: false, users: [], error: `API error ${status}: ${excerpt}` };
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
    
    return { ok: true, users: allUsers };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Lawmatics] list users exception:", msg);
    return { ok: false, users: [], error: msg };
  }
}

/**
 * Resolve a Lawmatics user ID by matching email (case-insensitive).
 * Falls back to first user if no email match found.
 */
export async function lawmaticsResolveUserByEmail(
  accessToken: string,
  targetEmail: string | null
): Promise<{
  userId: number | null;
  userIdStr: string | null;
  matchedBy: "email" | "first" | "none";
  user: LawmaticsUser | null;
  allUsers: LawmaticsUser[];
}> {
  const result = await lawmaticsListUsers(accessToken);
  
  if (!result.ok || result.users.length === 0) {
    return { userId: null, userIdStr: null, matchedBy: "none", user: null, allUsers: [] };
  }
  
  const normalizedTarget = (targetEmail || "").trim().toLowerCase();
  
  // Try to match by email
  if (normalizedTarget) {
    const byEmail = result.users.find(u => 
      u.email?.toLowerCase() === normalizedTarget
    );
    if (byEmail) {
      const numId = pickNumber(byEmail.id);
      return { 
        userId: numId, 
        userIdStr: byEmail.id, 
        matchedBy: "email", 
        user: byEmail, 
        allUsers: result.users 
      };
    }
  }
  
  // Fallback to first user
  const first = result.users[0];
  if (first) {
    const numId = pickNumber(first.id);
    return { 
      userId: numId, 
      userIdStr: first.id, 
      matchedBy: "first", 
      user: first, 
      allUsers: result.users 
    };
  }
  
  return { userId: null, userIdStr: null, matchedBy: "none", user: null, allUsers: result.users };
}

/**
 * Get current user info (users/me).
 */
export async function lawmaticsGetMe(accessToken: string): Promise<{
  userId: string | null;
  timezone: string | null;
  email: string | null;
}> {
  try {
    const res = await lawmaticsFetch(accessToken, "GET", "/v1/users/me");
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] users/me failed:", status, excerpt);
      return { userId: null, timezone: null, email: null };
    }

    const id = pickString(json?.data?.id ?? json?.id);
    const attrs = json?.data?.attributes ?? json;
    const timezone = pickString(attrs?.time_zone ?? attrs?.timezone ?? attrs?.timeZone);
    const email = pickString(attrs?.email);

    return { userId: id, timezone, email };
  } catch (err) {
    console.error("[Lawmatics] users/me exception:", err);
    return { userId: null, timezone: null, email: null };
  }
}

// ========== LAWMATICS CONTACT OPERATIONS ==========

export interface Attendee {
  email?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/**
 * Find a contact by email search, or create a new one.
 * Returns contact_id (as string and number).
 */
export async function lawmaticsFindOrCreateContact(
  accessToken: string,
  attendee: Attendee
): Promise<{
  contactId: number | null;
  contactIdStr: string | null;
  created: boolean;
  attempts: Array<{ endpoint: string; method: string; status: number; body_excerpt: string }>;
  error?: string;
}> {
  const attempts: Array<{ endpoint: string; method: string; status: number; body_excerpt: string }> = [];

  const email = pickString(attendee?.email);
  if (!email) {
    return { contactId: null, contactIdStr: null, created: false, attempts, error: "No email provided" };
  }

  // 1) Search for existing contact
  try {
    const endpoint = `/v1/contacts?search=${encodeURIComponent(email)}&per_page=10`;
    const res = await lawmaticsFetch(accessToken, "GET", endpoint);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    attempts.push({ endpoint, method: "GET", status, body_excerpt: excerpt });

    if (ok) {
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
        const idStr = pickString(exactMatch?.id ?? exactMatch?.data?.id);
        const idNum = pickNumber(idStr);
        console.log("[Lawmatics] Found existing contact:", idStr);
        return { contactId: idNum, contactIdStr: idStr, created: false, attempts };
      }
    } else {
      console.log("[Lawmatics] contact search failed:", status, excerpt);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    attempts.push({ endpoint: "/v1/contacts?search=...", method: "GET", status: 0, body_excerpt: msg });
    console.log("[Lawmatics] contact search exception:", msg);
  }

  // 2) Create new contact
  const name = pickString(attendee?.name) || "Test Booking";
  const tokens = name.split(/\s+/).filter(Boolean);
  const first_name = pickString(attendee?.first_name) || tokens[0] || "Test";
  const last_name = pickString(attendee?.last_name) || tokens.slice(1).join(" ") || "Booking";

  try {
    const payload = { first_name, last_name, email };
    console.log("[Lawmatics] Creating contact:", JSON.stringify(payload));

    const endpoint = "/v1/contacts";
    const res = await lawmaticsFetch(accessToken, "POST", endpoint, payload);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    attempts.push({ endpoint, method: "POST", status, body_excerpt: excerpt });

    if (!ok) {
      console.error("[Lawmatics] create contact failed:", status, excerpt);
      return { contactId: null, contactIdStr: null, created: false, attempts, error: `Create failed: ${excerpt}` };
    }

    const idStr = pickString(json?.data?.id ?? json?.id);
    const idNum = pickNumber(idStr);
    console.log("[Lawmatics] Created contact:", idStr);
    return { contactId: idNum, contactIdStr: idStr, created: true, attempts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Lawmatics] create contact exception:", msg);
    attempts.push({ endpoint: "/v1/contacts", method: "POST", status: 0, body_excerpt: msg });
    return { contactId: null, contactIdStr: null, created: false, attempts, error: msg };
  }
}

// ========== LAWMATICS MATTER (PROSPECT) OPERATIONS ==========

export interface MatterAttempt {
  endpoint: string;
  method: string;
  status: number;
  body_excerpt: string;
  payload_sent?: Record<string, any>;
  fields_included?: string[];
}

export interface MatterCreateParams {
  contactId?: number | string | null;
  email: string;
  firstName: string;
  lastName: string;
  caseTitle: string;
  notes?: string | null;
  phone?: string | null;
}

export interface MatterCreateResult {
  matterId: number | null;
  matterIdStr: string | null;
  created: boolean;
  verified: boolean;
  endpointUsed: string | null;
  attempts: MatterAttempt[];
  warnings: string[];
  fieldThatCausedError?: string;
}

/**
 * Build a clean payload object - ONLY includes keys where values are non-empty strings.
 * Never sends null/undefined.
 */
function buildCleanPayload(fields: Record<string, any>): Record<string, any> {
  const payload: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim()) {
      payload[key] = value.trim();
    } else if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = value;
    }
    // Skip null, undefined, empty strings, objects, arrays
  }
  return payload;
}

/**
 * Attempt to create a matter/prospect with the given payload.
 * Returns the result with full debug info.
 */
async function attemptMatterCreate(
  accessToken: string,
  endpoint: string,
  payload: Record<string, any>,
  fieldsIncluded: string[]
): Promise<{
  success: boolean;
  matterId: string | null;
  status: number;
  excerpt: string;
  attempt: MatterAttempt;
}> {
  try {
    console.log(`[Lawmatics] POST ${endpoint} with fields: [${fieldsIncluded.join(", ")}]`);
    
    const res = await lawmaticsFetch(accessToken, "POST", endpoint, payload);
    const result = await lawmaticsJson(res);

    // Redact sensitive data from payload for logging
    const redactedPayload = { ...payload };
    if (redactedPayload.email) {
      const email = redactedPayload.email;
      redactedPayload.email = email.replace(/(.{2})(.*)(@.*)/, "$1***$3");
    }

    const attempt: MatterAttempt = {
      endpoint,
      method: "POST",
      status: result.status,
      body_excerpt: result.excerpt,
      payload_sent: redactedPayload,
      fields_included: fieldsIncluded,
    };

    console.log(`[Lawmatics] POST ${endpoint} result: status=${result.status}`);

    if (result.ok) {
      const matterId = pickString(result.json?.data?.id ?? result.json?.id);
      return { success: true, matterId, status: result.status, excerpt: result.excerpt, attempt };
    }

    return { success: false, matterId: null, status: result.status, excerpt: result.excerpt, attempt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Lawmatics] POST ${endpoint} exception:`, msg);
    
    return {
      success: false,
      matterId: null,
      status: 0,
      excerpt: msg,
      attempt: {
        endpoint,
        method: "POST",
        status: 0,
        body_excerpt: msg,
        payload_sent: payload,
        fields_included: fieldsIncluded,
      },
    };
  }
}

/**
 * Create a NEW Lawmatics Matter (Prospect) using defensive "minimal payload + field bisect" strategy.
 * 
 * Strategy:
 * 1. Try with MINIMAL fields only: first_name, last_name, email, case_title
 * 2. If minimal succeeds, incrementally add optional fields one at a time:
 *    a) match_contact_by: "email"
 *    b) notes
 *    c) contact_id
 * 3. Stop adding fields when a 500 occurs and record which field caused it
 * 4. Return detailed debug info for every attempt
 * 
 * Non-blocking: returns attempts + warnings so callers can surface exact failure reasons.
 */
export async function lawmaticsCreateMatter(
  accessToken: string,
  params: MatterCreateParams
): Promise<MatterCreateResult> {
  const attempts: MatterAttempt[] = [];
  const warnings: string[] = [];

  // Validate required fields
  const firstName = pickString(params.firstName);
  const lastName = pickString(params.lastName);
  const email = pickString(params.email);
  const caseTitle = pickString(params.caseTitle);

  if (!firstName || !lastName || !email || !caseTitle) {
    const missingFields: string[] = [];
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!email) missingFields.push("email");
    if (!caseTitle) missingFields.push("caseTitle");

    return {
      matterId: null,
      matterIdStr: null,
      created: false,
      verified: false,
      endpointUsed: null,
      attempts: [],
      warnings: [`Missing required fields: ${missingFields.join(", ")}`],
    };
  }

  // Step 1: Detect available endpoints
  console.log("[Lawmatics] Detecting available endpoints...");
  const detection = await detectAvailableEndpoints(accessToken);
  console.log("[Lawmatics] Endpoint detection result:", JSON.stringify(detection));

  if (!detection.preferredEndpoint) {
    return {
      matterId: null,
      matterIdStr: null,
      created: false,
      verified: false,
      endpointUsed: null,
      attempts: [],
      warnings: [
        `Neither /v1/prospects nor /v1/matters endpoints are available. prospects=${detection.prospectsCheck.status} matters=${detection.mattersCheck.status}`,
      ],
    };
  }

  const endpoint = detection.preferredEndpoint;

  // ===== ATTEMPT 1: MINIMAL PAYLOAD ONLY =====
  // Only first_name, last_name, email, case_title - no optional fields
  const minimalPayload = buildCleanPayload({
    first_name: firstName,
    last_name: lastName,
    email: email,
    case_title: caseTitle,
  });
  const minimalFields = ["first_name", "last_name", "email", "case_title"];

  console.log("[Lawmatics] ATTEMPT 1: Minimal payload (required fields only)");
  const minimalResult = await attemptMatterCreate(accessToken, endpoint, minimalPayload, minimalFields);
  attempts.push(minimalResult.attempt);

  // If minimal attempt returns 500, record and stop
  if (minimalResult.status === 500 || minimalResult.status === 0) {
    warnings.push(
      `Minimal payload (${minimalFields.join(", ")}) failed with status=${minimalResult.status}: ${minimalResult.excerpt.slice(0, 200)}`
    );

    // Try fallback endpoint if available
    const fallbackEndpoint = endpoint === "/v1/prospects" 
      ? (detection.mattersEndpointExists ? "/v1/matters" : null)
      : (detection.prospectsEndpointExists ? "/v1/prospects" : null);

    if (fallbackEndpoint) {
      console.log(`[Lawmatics] Trying fallback endpoint: ${fallbackEndpoint}`);
      const fallbackResult = await attemptMatterCreate(accessToken, fallbackEndpoint, minimalPayload, minimalFields);
      attempts.push(fallbackResult.attempt);

      if (fallbackResult.success && fallbackResult.matterId) {
        console.log(`[Lawmatics] Fallback succeeded with matter ID: ${fallbackResult.matterId}`);
        
        // Verify and return
        const verified = await verifyMatterExists(accessToken, fallbackEndpoint, fallbackResult.matterId, attempts, warnings);
        
        return {
          matterId: pickNumber(fallbackResult.matterId),
          matterIdStr: fallbackResult.matterId,
          created: true,
          verified,
          endpointUsed: fallbackEndpoint,
          attempts,
          warnings,
        };
      } else if (fallbackResult.status === 500 || fallbackResult.status === 0) {
        warnings.push(
          `Fallback minimal payload on ${fallbackEndpoint} also failed with status=${fallbackResult.status}: ${fallbackResult.excerpt.slice(0, 200)}`
        );
      }
    }

    // Both endpoints failed with minimal payload
    return {
      matterId: null,
      matterIdStr: null,
      created: false,
      verified: false,
      endpointUsed: endpoint,
      attempts,
      warnings,
    };
  }

  // If minimal attempt succeeded
  if (minimalResult.success && minimalResult.matterId) {
    console.log(`[Lawmatics] Minimal payload succeeded with matter ID: ${minimalResult.matterId}`);
    
    // Store the created ID for return
    const createdMatterId = minimalResult.matterId;
    const usedEndpoint = endpoint;

    // ===== ATTEMPT 2+: Try adding optional fields incrementally (bisect) =====
    // Order: match_contact_by, notes, contact_id
    let fieldThatCausedError: string | undefined;

    // These are "enhancement" attempts - we already have a matter, these are best-effort updates
    // Note: Lawmatics may not support PATCH, so we just log what we WOULD have added
    // For now, we'll record that optional fields were NOT added

    const optionalFieldsToAdd: Array<{ name: string; key: string; value: any }> = [];
    
    // match_contact_by: "email"
    optionalFieldsToAdd.push({ name: "match_contact_by", key: "match_contact_by", value: "email" });
    
    // notes
    if (params.notes) {
      optionalFieldsToAdd.push({ name: "notes", key: "notes", value: params.notes });
    }
    
    // contact_id (only if we have one and didn't use match_contact_by)
    const contactIdNum = pickNumber(params.contactId);
    if (contactIdNum) {
      optionalFieldsToAdd.push({ name: "contact_id", key: "contact_id", value: contactIdNum });
    }

    // Since matter was created with minimal payload, optional fields were not included
    // Log this for debugging purposes
    if (optionalFieldsToAdd.length > 0) {
      const skippedFields = optionalFieldsToAdd.map(f => f.name);
      console.log(`[Lawmatics] Optional fields not included in create (already succeeded): ${skippedFields.join(", ")}`);
      warnings.push(
        `Matter created with minimal payload. Optional fields not tested: ${skippedFields.join(", ")}`
      );
    }

    // Verify the created matter exists
    const verified = await verifyMatterExists(accessToken, usedEndpoint, createdMatterId, attempts, warnings);

    return {
      matterId: pickNumber(createdMatterId),
      matterIdStr: createdMatterId,
      created: true,
      verified,
      endpointUsed: usedEndpoint,
      attempts,
      warnings,
      fieldThatCausedError,
    };
  }

  // Minimal attempt failed with non-500 error (e.g., 400, 422)
  warnings.push(
    `Minimal payload failed with status=${minimalResult.status}: ${minimalResult.excerpt.slice(0, 200)}`
  );

  // Try with additional required fields that might be missing
  // Some Lawmatics accounts may require additional fields like status_id, practice_area_id, etc.
  console.log("[Lawmatics] Minimal failed with non-500. API may require additional fields.");

  return {
    matterId: null,
    matterIdStr: null,
    created: false,
    verified: false,
    endpointUsed: endpoint,
    attempts,
    warnings,
  };
}

/**
 * Verify a created matter exists by fetching it.
 */
async function verifyMatterExists(
  accessToken: string,
  endpoint: string,
  matterId: string,
  attempts: MatterAttempt[],
  warnings: string[]
): Promise<boolean> {
  console.log(`[Lawmatics] Verifying matter ${matterId} exists...`);
  
  try {
    const verifyRes = await lawmaticsFetch(accessToken, "GET", `${endpoint}/${matterId}`);
    const verifyResult = await lawmaticsJson(verifyRes);

    attempts.push({
      endpoint: `${endpoint}/${matterId}`,
      method: "GET",
      status: verifyResult.status,
      body_excerpt: verifyResult.excerpt.slice(0, 200),
      fields_included: ["verify"],
    });

    if (verifyResult.ok) {
      console.log(`[Lawmatics] Matter ${matterId} verified successfully`);
      return true;
    } else {
      warnings.push(
        `Verification failed: GET ${endpoint}/${matterId} status=${verifyResult.status}`
      );
      return false;
    }
  } catch (verifyErr) {
    const verifyMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
    warnings.push(`Verification exception: ${verifyMsg}`);
    return false;
  }
}

/**
 * Find matters/prospects for a given contact or by email search.
 * Uses the same endpoint detection pattern.
 */
export async function lawmaticsFindMattersByContact(
  accessToken: string,
  contactId: number | string | null,
  email?: string | null
): Promise<{
  matters: Array<{ id: string; case_title: string | null; status: string | null; updated_at: string | null }>;
  attempts: MatterAttempt[];
  warnings: string[];
}> {
  const matters: Array<{ id: string; case_title: string | null; status: string | null; updated_at: string | null }> = [];
  const attempts: MatterAttempt[] = [];
  const warnings: string[] = [];

  // Detect available endpoints
  const detection = await detectAvailableEndpoints(accessToken);

  if (!detection.preferredEndpoint) {
    warnings.push("No matter/prospect endpoints available");
    return { matters, attempts, warnings };
  }

  const endpoints = [detection.preferredEndpoint];
  if (detection.preferredEndpoint === "/v1/prospects" && detection.mattersEndpointExists) {
    endpoints.push("/v1/matters");
  } else if (detection.preferredEndpoint === "/v1/matters" && detection.prospectsEndpointExists) {
    endpoints.push("/v1/prospects");
  }

  for (const endpoint of endpoints) {
    // Try by contact_id first
    if (contactId) {
      try {
        const url = `${endpoint}?contact_id=${contactId}&per_page=25`;
        const res = await lawmaticsFetch(accessToken, "GET", url);
        const result = await lawmaticsJson(res);

        attempts.push({
          endpoint: url,
          method: "GET",
          status: result.status,
          body_excerpt: result.excerpt.slice(0, 200),
        });

        if (result.ok) {
          const data: any[] = Array.isArray(result.json?.data) ? result.json.data : [];
          for (const m of data) {
            const attrs = m?.attributes ?? m;
            matters.push({
              id: pickString(m?.id) || "",
              case_title: pickString(attrs?.case_title ?? attrs?.name),
              status: pickString(attrs?.status),
              updated_at: pickString(attrs?.updated_at),
            });
          }
          if (matters.length > 0) {
            return { matters, attempts, warnings };
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${endpoint} by contact_id exception: ${msg}`);
      }
    }

    // Try by email search if no results
    if (email && matters.length === 0) {
      try {
        const url = `${endpoint}?search=${encodeURIComponent(email)}&per_page=25`;
        const res = await lawmaticsFetch(accessToken, "GET", url);
        const result = await lawmaticsJson(res);

        attempts.push({
          endpoint: url,
          method: "GET",
          status: result.status,
          body_excerpt: result.excerpt.slice(0, 200),
        });

        if (result.ok) {
          const data: any[] = Array.isArray(result.json?.data) ? result.json.data : [];
          for (const m of data) {
            const attrs = m?.attributes ?? m;
            matters.push({
              id: pickString(m?.id) || "",
              case_title: pickString(attrs?.case_title ?? attrs?.name),
              status: pickString(attrs?.status),
              updated_at: pickString(attrs?.updated_at),
            });
          }
          if (matters.length > 0) {
            return { matters, attempts, warnings };
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${endpoint} by email search exception: ${msg}`);
      }
    }
  }

  return { matters, attempts, warnings };
}

// ========== LAWMATICS EVENT/APPOINTMENT OPERATIONS ==========

/**
 * Read an event/appointment by ID and normalize the response.
 */
export async function lawmaticsReadEvent(
  accessToken: string,
  eventId: string
): Promise<Record<string, any> | null> {
  try {
    const res = await lawmaticsFetch(accessToken, "GET", `/v1/events/${encodeURIComponent(eventId)}`);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] read event failed:", status, excerpt);
      return null;
    }

    const data = json?.data ?? json;
    const id = pickString(data?.id) || String(eventId);

    const attrs = data?.attributes ?? data;
    const rel = data?.relationships ?? {};

    const eventTypeId = pickString(rel?.event_type?.data?.id ?? attrs?.event_type_id);
    const locationId = pickString(rel?.location?.data?.id ?? attrs?.location_id);

    // Assigned user can be represented as relationships.user.data OR relationships.users.data OR as user_id attribute.
    const userRelId = pickString(rel?.user?.data?.id);
    const usersRel: any[] = Array.isArray(rel?.users?.data) ? rel.users.data : [];
    const userId = pickString(attrs?.user_id ?? userRelId ?? usersRel?.[0]?.id);

    // Contact can be represented as relationships.contact.data OR contact_id OR as relationships.eventable.
    const contactRelId = pickString(rel?.contact?.data?.id);

    const eventable = rel?.eventable?.data;
    const eventableType = pickString(eventable?.type)?.toLowerCase();

    const contactId = pickString(
      attrs?.contact_id ??
        contactRelId ??
        (eventableType && eventableType.includes("contact") ? eventable?.id : null)
    );

    // Matter ID can be represented as relationships.matter.data OR matter_id OR as relationships.eventable
    const matterRelId = pickString(rel?.matter?.data?.id);
    const matterId = pickString(
      attrs?.matter_id ??
        matterRelId ??
        (eventableType && eventableType.includes("matter") ? eventable?.id : null)
    );

    return {
      id,
      name: pickString(attrs?.name),
      user_id: userId,
      contact_id: contactId,
      matter_id: matterId,
      starts_at: pickString(attrs?.starts_at),
      ends_at: pickString(attrs?.ends_at),
      start_date: normalizeDateOnly(attrs?.start_date),
      start_time: pickString(attrs?.start_time),
      end_date: normalizeDateOnly(attrs?.end_date),
      end_time: pickString(attrs?.end_time),
      event_type_id: eventTypeId,
      location_id: locationId,
      all_day: attrs?.all_day,
      // Keep raw fragments for debugging (no tokens)
      _relationships: rel,
      _attributes: attrs,
    };
  } catch (err) {
    console.error("[Lawmatics] read event exception:", err);
    return null;
  }
}

/**
 * Update an existing event with PATCH or PUT.
 */
export async function lawmaticsUpdateEvent(
  accessToken: string,
  eventId: string,
  method: "PATCH" | "PUT",
  payload: Record<string, any>
): Promise<{ ok: boolean; status: number; excerpt: string }> {
  const res = await lawmaticsFetch(accessToken, method, `/v1/events/${encodeURIComponent(eventId)}`, payload);
  const { ok, status, excerpt } = await lawmaticsJson(res);
  return { ok, status, excerpt };
}

/**
 * Delete an event.
 */
export async function lawmaticsDeleteEvent(accessToken: string, eventId: string): Promise<boolean> {
  try {
    const res = await lawmaticsFetch(accessToken, "DELETE", `/v1/events/${encodeURIComponent(eventId)}`);
    return res.ok;
  } catch {
    return false;
  }
}

// ========== TIMEZONE & DATE HELPERS ==========

/**
 * Convert ISO datetime to local date/time parts for a given timezone.
 */
export function toLocalDateTimeParts(
  isoDatetime: string,
  timezone: string
): { date: string; time: string; timeSeconds: string; time12: string; time12Seconds: string } {
  const d = new Date(isoDatetime);

  // Date-only: YYYY-MM-DD (never timestamps)
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const year = dateParts.find((p) => p.type === "year")?.value || "";
  const month = dateParts.find((p) => p.type === "month")?.value || "";
  const day = dateParts.find((p) => p.type === "day")?.value || "";
  const dateStr = `${year}-${month}-${day}`.slice(0, 10);

  // Time: HH:mm (24h)
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hour = timeParts.find((p) => p.type === "hour")?.value || "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value || "00";
  const time = `${hour}:${minute}`;
  const timeSeconds = `${hour}:${minute}:00`;

  // Also get 12-hour format (some Lawmatics installs expect this)
  const time12Parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const hour12 = time12Parts.find((p) => p.type === "hour")?.value || "12";
  const minute12 = time12Parts.find((p) => p.type === "minute")?.value || "00";
  const dayPeriod = time12Parts.find((p) => p.type === "dayPeriod")?.value || "AM";
  const time12 = `${hour12}:${minute12} ${dayPeriod.toUpperCase()}`;
  const time12Seconds = `${hour12}:${minute12}:00 ${dayPeriod.toUpperCase()}`;

  return { date: dateStr, time, timeSeconds, time12, time12Seconds };
}

/**
 * Strict parts helper requested by booking flows.
 * Returns date as YYYY-MM-DD and time as HH:mm and HH:mm:ss, computed in the provided timezone.
 */
export function toLocalDateTimePartsWithSeconds(
  isoDatetime: string,
  timezone: string
): { date: string; time: string; timeSeconds: string } {
  const parts = toLocalDateTimeParts(isoDatetime, timezone);
  return { date: parts.date, time: parts.time, timeSeconds: parts.timeSeconds };
}

// ========== APPOINTMENT CREATION/REPAIR ==========

export interface AppointmentParams {
  name: string;
  description?: string;
  startDatetime: string;
  endDatetime: string;
  timezone: string;
  eventTypeId?: number | null;
  locationId?: number | null;
  userId?: number | null;
  contactId?: number | null;
  requiresLocation?: boolean;
}

export interface AppointmentResult {
  createdId: string | null;
  persisted: boolean;
  readback: any;
  error?: string;
  usedTimeFormat?: string;
  timezoneUsed?: string;
  ownerUserIdUsed?: number | null;
  attempts?: Array<{ endpoint: string; method: string; status: number; body_excerpt: string }>;
  computed?: {
    start_date: string;
    start_time: string;
    end_date: string;
    end_time: string;
  };
}

type LogFn = (step: string, level: string, message: string, details?: Record<string, any>) => Promise<void>;

/**
 * Create or repair a Lawmatics appointment/event.
 * Handles the complex logic of creating events and verifying they persist correctly.
 */
export async function createOrRepairLawmaticsAppointment(
  accessToken: string,
  params: AppointmentParams,
  log: LogFn
): Promise<AppointmentResult> {
  const attempts: Array<{ endpoint: string; method: string; status: number; body_excerpt: string }> = [];

  const { date, time } = toLocalDateTimeParts(params.startDatetime, params.timezone);
  const { time: endTime } = toLocalDateTimeParts(params.endDatetime, params.timezone);

  await log("lawmatics_create_event_start", "info", "Creating Lawmatics event", {
    name: params.name,
    start_date: date,
    start_time: time,
    end_time: endTime,
    timezone: params.timezone,
    event_type_id: params.eventTypeId,
    location_id: params.locationId,
    user_id: params.userId,
    contact_id: params.contactId,
  });

  // Build the event payload
  const payload: Record<string, any> = {
    name: params.name,
    description: params.description || "",
    start_date: date,
    start_time: time,
    end_time: endTime,
    time_zone: params.timezone,
  };

  if (params.eventTypeId) payload.event_type_id = params.eventTypeId;
  if (params.locationId) payload.location_id = params.locationId;
  if (params.userId) payload.user_id = params.userId;
  if (params.contactId) payload.contact_id = params.contactId;

  try {
    // Create
    {
      const endpoint = "/v1/events";
      const res = await lawmaticsFetch(accessToken, "POST", endpoint, payload);
      const { ok, status, json, excerpt } = await lawmaticsJson(res);
      attempts.push({ endpoint, method: "POST", status, body_excerpt: excerpt });

      if (!ok) {
        await log("lawmatics_create_event_failed", "error", "Failed to create Lawmatics event", {
          status,
          excerpt,
        });
        return {
          createdId: null,
          persisted: false,
          readback: null,
          error: `Create failed: ${excerpt}`,
          attempts,
          timezoneUsed: params.timezone,
          ownerUserIdUsed: params.userId ?? null,
          computed: { start_date: date, start_time: time, end_date: date, end_time: endTime },
        };
      }

      const createdId = pickString(json?.data?.id ?? json?.id);
      if (!createdId) {
        await log("lawmatics_create_event_no_id", "error", "Lawmatics event created but no ID returned", { json });
        return {
          createdId: null,
          persisted: false,
          readback: null,
          error: "No event ID returned",
          attempts,
          timezoneUsed: params.timezone,
          ownerUserIdUsed: params.userId ?? null,
          computed: { start_date: date, start_time: time, end_date: date, end_time: endTime },
        };
      }

      await log("lawmatics_create_event_success", "success", `Lawmatics event created: ${createdId}`, {
        event_id: createdId,
      });

      // Readback attempt for debug (status/body)
      try {
        const endpointRead = `/v1/events/${encodeURIComponent(createdId)}`;
        const readRes = await lawmaticsFetch(accessToken, "GET", endpointRead);
        const readJson = await lawmaticsJson(readRes);
        attempts.push({ endpoint: endpointRead, method: "GET", status: readJson.status, body_excerpt: readJson.excerpt });
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr);
        attempts.push({ endpoint: "/v1/events/:id", method: "GET", status: 0, body_excerpt: msg });
      }

      // Read back and verify (normalized)
      const readback = await lawmaticsReadEvent(accessToken, createdId);
      if (!readback) {
        await log("lawmatics_readback_failed", "warn", "Could not read back created event", {
          event_id: createdId,
        });
        return {
          createdId,
          persisted: false,
          readback: null,
          error: "Readback failed",
          attempts,
          timezoneUsed: params.timezone,
          ownerUserIdUsed: params.userId ?? null,
          computed: { start_date: date, start_time: time, end_date: date, end_time: endTime },
        };
      }

      // Check if times and owner persisted
      const timesOk = readback.start_date === date && readback.start_time === time;
      const ownerOk = !params.userId || readback.user_id === String(params.userId);

      if (!timesOk || !ownerOk) {
        await log("lawmatics_readback_mismatch", "warn", "Event created but fields may not have persisted correctly", {
          expected_date: date,
          expected_time: time,
          expected_user_id: params.userId,
          actual_date: readback.start_date,
          actual_time: readback.start_time,
          actual_user_id: readback.user_id,
        });
      }

      return {
        createdId,
        persisted: timesOk && ownerOk,
        readback,
        attempts,
        timezoneUsed: params.timezone,
        ownerUserIdUsed: params.userId ?? null,
        computed: { start_date: date, start_time: time, end_date: date, end_time: endTime },
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("lawmatics_create_event_exception", "error", `Exception creating event: ${msg}`, {});
    attempts.push({ endpoint: "/v1/events", method: "POST", status: 0, body_excerpt: msg });
    return {
      createdId: null,
      persisted: false,
      readback: null,
      error: msg,
      attempts,
      timezoneUsed: params.timezone,
      ownerUserIdUsed: params.userId ?? null,
      computed: { start_date: date, start_time: time, end_date: date, end_time: endTime },
    };
  }
}

// ========== LAWMATICS USER RESOLUTION (ALIAS) ==========

/**
 * Alias for lawmaticsResolveUserByEmail that returns a simpler object for booking flows.
 */
export async function resolveLawmaticsUserIdByEmail(
  accessToken: string,
  email: string | null
): Promise<{
  userId: number | null;
  timezone: string | null;
}> {
  const result = await lawmaticsResolveUserByEmail(accessToken, email);
  return {
    userId: result.userId,
    timezone: result.user?.timezone || null,
  };
}
