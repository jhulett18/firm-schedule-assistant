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
    excerpt: (text || "").slice(0, 300),
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

// ========== LAWMATICS CONTACT/MATTER OPERATIONS ==========

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
  error?: string;
}> {
  const email = pickString(attendee?.email);
  if (!email) {
    return { contactId: null, contactIdStr: null, created: false, error: "No email provided" };
  }

  // 1) Search for existing contact
  try {
    const res = await lawmaticsFetch(
      accessToken,
      "GET",
      `/v1/contacts?search=${encodeURIComponent(email)}&per_page=10`
    );
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (ok) {
      const contacts: any[] = Array.isArray(json?.data) 
        ? json.data 
        : Array.isArray(json?.contacts) 
          ? json.contacts 
          : [];
      
      // Find exact email match (case-insensitive)
      const normalizedEmail = email.toLowerCase();
      const exactMatch = contacts.find(c => {
        const attrs = c?.attributes ?? c;
        const contactEmail = pickString(attrs?.email);
        return contactEmail?.toLowerCase() === normalizedEmail;
      });
      
      if (exactMatch) {
        const idStr = pickString(exactMatch?.id ?? exactMatch?.data?.id);
        const idNum = pickNumber(idStr);
        console.log("[Lawmatics] Found existing contact:", idStr);
        return { contactId: idNum, contactIdStr: idStr, created: false };
      }
    } else {
      console.log("[Lawmatics] contact search failed:", status, excerpt);
    }
  } catch (err) {
    console.log("[Lawmatics] contact search exception:", err);
  }

  // 2) Create new contact
  const name = pickString(attendee?.name) || "Test Booking";
  const tokens = name.split(/\s+/).filter(Boolean);
  const first_name = pickString(attendee?.first_name) || tokens[0] || "Test";
  const last_name = pickString(attendee?.last_name) || tokens.slice(1).join(" ") || "Booking";

  try {
    const payload = { first_name, last_name, email };
    console.log("[Lawmatics] Creating contact:", JSON.stringify(payload));
    
    const res = await lawmaticsFetch(accessToken, "POST", "/v1/contacts", payload);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] create contact failed:", status, excerpt);
      return { contactId: null, contactIdStr: null, created: false, error: `Create failed: ${excerpt}` };
    }

    const idStr = pickString(json?.data?.id ?? json?.id);
    const idNum = pickNumber(idStr);
    console.log("[Lawmatics] Created contact:", idStr);
    return { contactId: idNum, contactIdStr: idStr, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Lawmatics] create contact exception:", msg);
    return { contactId: null, contactIdStr: null, created: false, error: msg };
  }
}

/**
 * Find a matter by contact ID or email, or create a new one.
 * Returns matter_id.
 */
export async function lawmaticsFindOrCreateMatter(
  accessToken: string,
  contactId: number | string | null,
  attendee: Attendee,
  matterName?: string
): Promise<{
  matterId: number | null;
  matterIdStr: string | null;
  created: boolean;
  error?: string;
}> {
  const email = pickString(attendee?.email);
  
  // 1) If we have a contact ID, try to find their existing matter
  if (contactId) {
    try {
      const res = await lawmaticsFetch(
        accessToken,
        "GET",
        `/v1/matters?contact_id=${contactId}&per_page=5`
      );
      const { ok, json } = await lawmaticsJson(res);
      
      if (ok) {
        const matters: any[] = Array.isArray(json?.data) ? json.data : [];
        if (matters.length > 0) {
          const first = matters[0];
          const idStr = pickString(first?.id);
          const idNum = pickNumber(idStr);
          console.log("[Lawmatics] Found existing matter for contact:", idStr);
          return { matterId: idNum, matterIdStr: idStr, created: false };
        }
      }
    } catch (err) {
      console.log("[Lawmatics] matter search by contact failed:", err);
    }
  }
  
  // 2) Search by email if no contact ID provided or no matter found
  if (email && !contactId) {
    try {
      const res = await lawmaticsFetch(
        accessToken,
        "GET",
        `/v1/matters?search=${encodeURIComponent(email)}&per_page=5`
      );
      const { ok, json } = await lawmaticsJson(res);
      
      if (ok) {
        const matters: any[] = Array.isArray(json?.data) ? json.data : [];
        if (matters.length > 0) {
          const first = matters[0];
          const idStr = pickString(first?.id);
          const idNum = pickNumber(idStr);
          console.log("[Lawmatics] Found existing matter by email search:", idStr);
          return { matterId: idNum, matterIdStr: idStr, created: false };
        }
      }
    } catch (err) {
      console.log("[Lawmatics] matter search by email failed:", err);
    }
  }
  
  // 3) Create new matter
  if (!contactId) {
    return { matterId: null, matterIdStr: null, created: false, error: "No contact ID to create matter" };
  }
  
  try {
    const payload = {
      name: matterName || `Booking - ${attendee?.name || email || "Unknown"}`,
      contact_id: pickNumber(contactId),
    };
    console.log("[Lawmatics] Creating matter:", JSON.stringify(payload));
    
    const res = await lawmaticsFetch(accessToken, "POST", "/v1/matters", payload);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);
    
    if (!ok) {
      console.error("[Lawmatics] create matter failed:", status, excerpt);
      return { matterId: null, matterIdStr: null, created: false, error: `Create failed: ${excerpt}` };
    }
    
    const idStr = pickString(json?.data?.id ?? json?.id);
    const idNum = pickNumber(idStr);
    console.log("[Lawmatics] Created matter:", idStr);
    return { matterId: idNum, matterIdStr: idStr, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Lawmatics] create matter exception:", msg);
    return { matterId: null, matterIdStr: null, created: false, error: msg };
  }
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

    // Lawmatics often represents assigned users via relationships.users.data
    const usersRel: any[] = Array.isArray(rel?.users?.data) ? rel.users.data : [];
    const userId = pickString(attrs?.user_id ?? usersRel?.[0]?.id);

    // Contact can be represented as contact_id OR as relationships.eventable
    const eventable = rel?.eventable?.data;
    const eventableType = pickString(eventable?.type)?.toLowerCase();
    const contactId = pickString(
      attrs?.contact_id ??
        (eventableType && eventableType.includes("contact") ? eventable?.id : null)
    );
    
    // Matter ID
    const matterId = pickString(
      attrs?.matter_id ??
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
): { date: string; time: string; timeSeconds: string; time12: string } {
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

  return { date: dateStr, time, timeSeconds, time12 };
}

// ========== APPOINTMENT CREATION WITH VERIFICATION ==========

export interface CreateAppointmentOptions {
  name: string;
  description: string;
  startDatetime: string;  // ISO
  endDatetime: string;    // ISO
  timezone: string;
  eventTypeId: number | null;
  locationId: number | null;
  userId: number | null;        // Lawmatics user ID (firm host)
  contactId: number | null;     // Lawmatics contact ID (attendee)
  matterId?: number | null;     // Optional matter ID
  requiresLocation: boolean;
}

export interface CreateAppointmentResult {
  ok: boolean;
  complete: boolean;          // True if all required fields are populated
  createdId: string | null;
  readback: Record<string, any> | null;
  missingFields: string[];
  attempts: Array<{ step: string; status: number; ok: boolean; note?: string }>;
  error?: string;
}

/**
 * Create a Lawmatics appointment with comprehensive validation.
 * Sends IDs as NUMBERS, includes both ISO and date/time parts,
 * and verifies the readback has all required fields.
 */
export async function createLawmaticsAppointment(
  accessToken: string,
  opts: CreateAppointmentOptions
): Promise<CreateAppointmentResult> {
  const attempts: Array<{ step: string; status: number; ok: boolean; note?: string }> = [];
  
  const startParts = toLocalDateTimeParts(opts.startDatetime, opts.timezone);
  const endParts = toLocalDateTimeParts(opts.endDatetime, opts.timezone);

  // Primary payload uses HH:mm, fallback uses HH:mm:ss
  const canonical: Record<string, any> = {
    name: opts.name,
    description: opts.description,
    all_day: false,
    is_all_day: false,

    // ISO timestamps
    starts_at: opts.startDatetime,
    ends_at: opts.endDatetime,

    // Date-only and time parts
    start_date: startParts.date, // YYYY-MM-DD
    start_time: startParts.time, // HH:mm
    end_date: endParts.date,
    end_time: endParts.time,
  };

  const canonicalSeconds: Record<string, any> = {
    ...canonical,
    start_time: startParts.timeSeconds,
    end_time: endParts.timeSeconds,
  };

  // Add IDs as NUMBERS (critical!)
  if (opts.eventTypeId) canonical.event_type_id = parseInt(String(opts.eventTypeId), 10);
  if (opts.locationId) canonical.location_id = parseInt(String(opts.locationId), 10);
  if (opts.userId) {
    canonical.user_id = parseInt(String(opts.userId), 10);
    canonical.user_ids = [parseInt(String(opts.userId), 10)];
  }
  if (opts.contactId) {
    canonical.contact_id = parseInt(String(opts.contactId), 10);
    canonical.eventable_type = "Contact";
    canonical.eventable_id = parseInt(String(opts.contactId), 10);
  }
  if (opts.matterId) {
    canonical.matter_id = parseInt(String(opts.matterId), 10);
    canonical.eventable_type = "Matter";
    canonical.eventable_id = parseInt(String(opts.matterId), 10);
  }

  // Mirror IDs to seconds payload
  for (const k of [
    "event_type_id",
    "location_id",
    "user_id",
    "user_ids",
    "contact_id",
    "matter_id",
    "eventable_type",
    "eventable_id",
  ]) {
    if (canonical[k] !== undefined) canonicalSeconds[k] = canonical[k];
  }

  // Helper to compute which required fields are missing from readback
  const computeMissingFields = (rb: Record<string, any> | null): string[] => {
    const missing: string[] = [];
    if (!rb) return ["readback"];

    if (!rb.user_id) missing.push("user_id");

    const hasTimeStart = rb.starts_at || (rb.start_date && rb.start_time);
    const hasTimeEnd = rb.ends_at || (rb.end_date && rb.end_time);
    if (!hasTimeStart) missing.push("start_time");
    if (!hasTimeEnd) missing.push("end_time");

    if (opts.eventTypeId && !rb.event_type_id) missing.push("event_type_id");
    if (opts.requiresLocation && opts.locationId && !rb.location_id) missing.push("location_id");
    if (opts.contactId && !rb.contact_id && !rb.matter_id) missing.push("contact_id");

    return missing;
  };

  // Helper to post an event and track attempt
  const postEvent = async (
    step: string,
    payload: any
  ): Promise<{ createdId: string | null; status: number; ok: boolean; excerpt: string }> => {
    const res = await lawmaticsFetch(accessToken, "POST", "/v1/events", payload);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);
    attempts.push({ step, status, ok, note: excerpt || undefined });
    return { createdId: pickString(json?.data?.id ?? json?.id), status, ok, excerpt };
  };

  // Attempt 1: HH:mm
  console.log("[Lawmatics] Creating appointment attempt 1 (HH:mm):", {
    ...canonical,
    description: canonical.description?.slice(0, 50) + "...",
  });

  let a1 = await postEvent("create_hhmm", canonical);

  // If attempt 1 fails, try HH:mm:ss
  if (!a1.ok) {
    console.log("[Lawmatics] Creating appointment attempt 2 (HH:mm:ss)");
    a1 = await postEvent("create_hhmmss", canonicalSeconds);
  }

  // If still failing, try with 12-hour time format
  if (!a1.ok) {
    const canonical12h = { ...canonical, start_time: startParts.time12, end_time: endParts.time12 };
    console.log("[Lawmatics] Retrying with 12h time format:", startParts.time12, endParts.time12);
    a1 = await postEvent("create_12h_time", canonical12h);
  }
  
  // If still failing, try wrapped in {event: ...}
  if (!a1.ok) {
    console.log("[Lawmatics] Retrying with {event: payload} envelope");
    a1 = await postEvent("create_event_envelope", { event: canonical });
  }
  
  // If still failing, try wrapped in {data: ...}
  if (!a1.ok) {
    console.log("[Lawmatics] Retrying with {data: payload} envelope");
    a1 = await postEvent("create_data_envelope", { data: canonical });
  }
  
  if (!a1.ok || !a1.createdId) {
    return {
      ok: false,
      complete: false,
      createdId: null,
      readback: null,
      missingFields: ["create_failed"],
      attempts,
      error: `Lawmatics create failed: ${a1.excerpt}`,
    };
  }
  
  // Read back the created event
  console.log("[Lawmatics] Created event ID:", a1.createdId, "- reading back...");
  const readback = await lawmaticsReadEvent(accessToken, a1.createdId);
  const missingFields = computeMissingFields(readback);
  
  if (missingFields.length === 0) {
    console.log("[Lawmatics] Appointment created and verified complete");
    return {
      ok: true,
      complete: true,
      createdId: a1.createdId,
      readback,
      missingFields: [],
      attempts,
    };
  }
  
  console.log("[Lawmatics] Appointment created but incomplete, missing:", missingFields);

  // If the only problem is missing time fields, try HH:mm:ss first (this is the common failure mode)
  const missingTimes = missingFields.includes("start_time") || missingFields.includes("end_time");
  if (missingTimes) {
    const patchSeconds = await lawmaticsUpdateEvent(accessToken, a1.createdId, "PATCH", canonicalSeconds);
    attempts.push({
      step: "patch_repair_hhmmss",
      status: patchSeconds.status,
      ok: patchSeconds.ok,
      note: patchSeconds.excerpt,
    });

    const readbackSeconds = await lawmaticsReadEvent(accessToken, a1.createdId);
    const missingSeconds = computeMissingFields(readbackSeconds);

    if (missingSeconds.length === 0) {
      console.log("[Lawmatics] Appointment repaired via HH:mm:ss PATCH");
      return {
        ok: true,
        complete: true,
        createdId: a1.createdId,
        readback: readbackSeconds,
        missingFields: [],
        attempts,
      };
    }
  }

  // Try to repair with PATCH (HH:mm)
  const patchResult = await lawmaticsUpdateEvent(accessToken, a1.createdId, "PATCH", canonical);
  attempts.push({ step: "patch_repair", status: patchResult.status, ok: patchResult.ok, note: patchResult.excerpt });

  if (patchResult.ok) {
    const readback2 = await lawmaticsReadEvent(accessToken, a1.createdId);
    const missing2 = computeMissingFields(readback2);

    if (missing2.length === 0) {
      console.log("[Lawmatics] Appointment repaired via PATCH");
      return {
        ok: true,
        complete: true,
        createdId: a1.createdId,
        readback: readback2,
        missingFields: [],
        attempts,
      };
    }

    // Try PUT if PATCH didn't fully fix it
    const putResult = await lawmaticsUpdateEvent(accessToken, a1.createdId, "PUT", canonical);
    attempts.push({ step: "put_repair", status: putResult.status, ok: putResult.ok, note: putResult.excerpt });

    if (putResult.ok) {
      const readback3 = await lawmaticsReadEvent(accessToken, a1.createdId);
      const missing3 = computeMissingFields(readback3);

      if (missing3.length === 0) {
        console.log("[Lawmatics] Appointment repaired via PUT");
        return {
          ok: true,
          complete: true,
          createdId: a1.createdId,
          readback: readback3,
          missingFields: [],
          attempts,
        };
      }

      // Still incomplete after repairs
      return {
        ok: true, // Created, just incomplete
        complete: false,
        createdId: a1.createdId,
        readback: readback3,
        missingFields: missing3,
        attempts,
      };
    }
  }

  // Return incomplete result
  return {
    ok: true, // Created, just incomplete
    complete: false,
    createdId: a1.createdId,
    readback,
    missingFields,
    attempts,
  };
}
