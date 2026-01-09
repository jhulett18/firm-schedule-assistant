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

/**
 * Strict parts helper requested by booking flows.
 * Returns date as YYYY-MM-DD and time as HH:mm and HH:mm:ss, computed in the provided timezone.
 */
export function toLocalDateTimePartsWithSeconds(
  isoDatetime: string,
  timezone: string
): { date: string; timeHM: string; timeHMS: string } {
  const d = new Date(isoDatetime);

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const year = dateParts.find((p) => p.type === "year")?.value || "";
  const month = dateParts.find((p) => p.type === "month")?.value || "";
  const day = dateParts.find((p) => p.type === "day")?.value || "";
  const date = `${year}-${month}-${day}`.slice(0, 10);

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hour = timeParts.find((p) => p.type === "hour")?.value || "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value || "00";
  const second = timeParts.find((p) => p.type === "second")?.value || "00";

  return {
    date,
    timeHM: `${hour}:${minute}`,
    timeHMS: `${hour}:${minute}:${second}`,
  };
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
export type BookingProgressLogger = (
  step: string,
  level: "info" | "warn" | "error" | "success",
  message: string,
  details?: Record<string, any>
) => Promise<void>;

export async function resolveLawmaticsUserIdByEmail(
  accessToken: string,
  email: string | null
): Promise<{ userId: number | null; timezone: string | null }> {
  const target = (email || "").trim().toLowerCase();
  if (!target) return { userId: null, timezone: null };

  try {
    const res = await lawmaticsFetch(accessToken, "GET", `/v1/users?per_page=200`);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] resolve user by email failed:", status, excerpt);
      return { userId: null, timezone: null };
    }

    const rawUsers: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.users)
        ? json.users
        : Array.isArray(json)
          ? json
          : [];

    for (const u of rawUsers) {
      const attrs = u?.attributes ?? u;
      const uEmail = pickString(attrs?.email)?.toLowerCase();
      if (uEmail === target) {
        const userId = pickNumber(u?.id);
        const timezone = pickString(attrs?.time_zone ?? attrs?.timezone ?? attrs?.timeZone);
        return { userId, timezone };
      }
    }

    return { userId: null, timezone: null };
  } catch (err) {
    console.error("[Lawmatics] resolve user by email exception:", err);
    return { userId: null, timezone: null };
  }
}

export type LawmaticsTimeFormat = "HH:mm:ss" | "HH:mm";

export type CreateOrRepairAppointmentResult = {
  createdId: string | null;
  ownerUserIdUsed: number | null;
  usedTimeFormat: LawmaticsTimeFormat;
  persisted: boolean;
  timezoneUsed: string;
  computed: {
    start_date: string;
    start_time: string;
    end_date: string;
    end_time: string;
  };
  readback: Record<string, any> | null;
  attempts: Array<{ step: string; status: number | null; ok: boolean; note?: string }>;
  error?: string;
};

export async function createOrRepairLawmaticsAppointment(
  accessToken: string,
  opts: CreateAppointmentOptions,
  progress?: BookingProgressLogger
): Promise<CreateOrRepairAppointmentResult> {
  const attempts: Array<{ step: string; status: number | null; ok: boolean; note?: string }> = [];

  const tz = opts.timezone;

  // Compute strict parts in the target timezone
  const startParts = toLocalDateTimePartsWithSeconds(opts.startDatetime, tz);
  const endParts = toLocalDateTimePartsWithSeconds(opts.endDatetime, tz);

  const payloadHMS: Record<string, any> = {
    name: opts.name,
    description: opts.description,
    start_date: startParts.date,
    start_time: startParts.timeHMS,
    end_date: endParts.date,
    end_time: endParts.timeHMS,
    all_day: false,
    is_all_day: false,
  };

  const payloadHM: Record<string, any> = {
    ...payloadHMS,
    start_time: startParts.timeHM,
    end_time: endParts.timeHM,
  };

  // IDs must be numbers
  const ownerUserIdUsed = opts.userId ? parseInt(String(opts.userId), 10) : null;
  if (ownerUserIdUsed) payloadHMS.user_id = ownerUserIdUsed;
  if (ownerUserIdUsed) payloadHM.user_id = ownerUserIdUsed;

  if (opts.eventTypeId) {
    const v = parseInt(String(opts.eventTypeId), 10);
    payloadHMS.event_type_id = v;
    payloadHM.event_type_id = v;
  }

  if (opts.locationId) {
    const v = parseInt(String(opts.locationId), 10);
    payloadHMS.location_id = v;
    payloadHM.location_id = v;
  }

  if (opts.contactId) {
    const v = parseInt(String(opts.contactId), 10);
    payloadHMS.contact_id = v;
    payloadHM.contact_id = v;
  }

  if (opts.matterId) {
    const v = parseInt(String(opts.matterId), 10);
    payloadHMS.matter_id = v;
    payloadHM.matter_id = v;
  }

  // Helper: does readback show persisted times?
  const hasTimes = (rb: Record<string, any> | null): boolean => {
    if (!rb) return false;
    const hasStart = !!rb.starts_at || (!!rb.start_date && !!rb.start_time);
    const hasEnd = !!rb.ends_at || (!!rb.end_date && !!rb.end_time);
    return hasStart && hasEnd;
  };

  const hasOwnerIfExpected = (rb: Record<string, any> | null): boolean => {
    if (!ownerUserIdUsed) return true;
    const rbUser = pickNumber(rb?.user_id);
    return rbUser === ownerUserIdUsed;
  };

  const persistOk = (rb: Record<string, any> | null) => hasTimes(rb) && hasOwnerIfExpected(rb);

  const log = async (
    step: string,
    level: "info" | "warn" | "error" | "success",
    message: string,
    details?: Record<string, any>
  ) => {
    try {
      await progress?.(step, level, message, details);
    } catch {
      // Never let logging break the booking flow
    }
  };

  await log("lawmatics_create_request", "info", "Posting Lawmatics appointment", {
    timezoneUsed: tz,
    computed: {
      start_date: startParts.date,
      start_time_hms: startParts.timeHMS,
      start_time_hm: startParts.timeHM,
      end_date: endParts.date,
      end_time_hms: endParts.timeHMS,
      end_time_hm: endParts.timeHM,
    },
    payloadKeys: Object.keys(payloadHMS),
  });

  // 1) Create with HH:mm:ss
  let createdId: string | null = null;
  try {
    const res = await lawmaticsFetch(accessToken, "POST", "/v1/events", payloadHMS);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);
    attempts.push({ step: "create_post_hms", ok, status, note: excerpt || undefined });

    await log("lawmatics_create_response", ok ? "success" : "error", "Lawmatics create response", {
      status,
      excerpt: excerpt?.slice(0, 500),
    });

    if (!ok) {
      return {
        createdId: null,
        ownerUserIdUsed,
        usedTimeFormat: "HH:mm:ss",
        persisted: false,
        timezoneUsed: tz,
        computed: { start_date: startParts.date, start_time: startParts.timeHMS, end_date: endParts.date, end_time: endParts.timeHMS },
        readback: null,
        attempts,
        error: `Lawmatics create failed (${status}): ${excerpt}`,
      };
    }

    createdId = pickString(json?.data?.id ?? json?.id);
    if (!createdId) {
      return {
        createdId: null,
        ownerUserIdUsed,
        usedTimeFormat: "HH:mm:ss",
        persisted: false,
        timezoneUsed: tz,
        computed: { start_date: startParts.date, start_time: startParts.timeHMS, end_date: endParts.date, end_time: endParts.timeHMS },
        readback: null,
        attempts,
        error: "Lawmatics create returned no id",
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      createdId: null,
      ownerUserIdUsed,
      usedTimeFormat: "HH:mm:ss",
      persisted: false,
      timezoneUsed: tz,
      computed: { start_date: startParts.date, start_time: startParts.timeHMS, end_date: endParts.date, end_time: endParts.timeHMS },
      readback: null,
      attempts,
      error: `Lawmatics create exception: ${msg}`,
    };
  }

  // 2) Readback
  await log("lawmatics_readback_after_create", "info", "Reading Lawmatics appointment", { event_id: createdId });
  let readback = await lawmaticsReadEvent(accessToken, createdId);

  if (persistOk(readback)) {
    await log("lawmatics_final_status", "success", "Lawmatics appointment persisted", { event_id: createdId });
    return {
      createdId,
      ownerUserIdUsed,
      usedTimeFormat: "HH:mm:ss",
      persisted: true,
      timezoneUsed: tz,
      computed: { start_date: startParts.date, start_time: startParts.timeHMS, end_date: endParts.date, end_time: endParts.timeHMS },
      readback,
      attempts,
    };
  }

  // 3) Repair via PUT with HH:mm:ss
  await log("lawmatics_repair_put_request", "warn", "Repairing Lawmatics appointment via PUT (HH:mm:ss)", {
    event_id: createdId,
  });

  const put1 = await lawmaticsUpdateEvent(accessToken, createdId, "PUT", payloadHMS);
  attempts.push({ step: "repair_put_hms", ok: put1.ok, status: put1.status, note: put1.excerpt || undefined });

  await log("lawmatics_readback_after_repair", "info", "Reading Lawmatics appointment after PUT (HH:mm:ss)", {
    event_id: createdId,
    status: put1.status,
    ok: put1.ok,
    excerpt: put1.excerpt?.slice(0, 500),
  });

  readback = await lawmaticsReadEvent(accessToken, createdId);
  if (persistOk(readback)) {
    await log("lawmatics_final_status", "success", "Lawmatics appointment persisted after repair", { event_id: createdId });
    return {
      createdId,
      ownerUserIdUsed,
      usedTimeFormat: "HH:mm:ss",
      persisted: true,
      timezoneUsed: tz,
      computed: { start_date: startParts.date, start_time: startParts.timeHMS, end_date: endParts.date, end_time: endParts.timeHMS },
      readback,
      attempts,
    };
  }

  // 4) Repair via PUT with HH:mm fallback
  await log("lawmatics_repair_put_request", "warn", "Repairing Lawmatics appointment via PUT (HH:mm)", { event_id: createdId });

  const put2 = await lawmaticsUpdateEvent(accessToken, createdId, "PUT", payloadHM);
  attempts.push({ step: "repair_put_hm", ok: put2.ok, status: put2.status, note: put2.excerpt || undefined });

  readback = await lawmaticsReadEvent(accessToken, createdId);
  const persisted = persistOk(readback);

  await log("lawmatics_final_status", persisted ? "success" : "error", "Lawmatics final persisted status", {
    event_id: createdId,
    persisted,
    readback: readback
      ? {
          start_date: readback.start_date,
          start_time: readback.start_time,
          end_date: readback.end_date,
          end_time: readback.end_time,
          starts_at: readback.starts_at,
          ends_at: readback.ends_at,
          user_id: readback.user_id,
          event_type_id: readback.event_type_id,
          location_id: readback.location_id,
        }
      : null,
  });

  return {
    createdId,
    ownerUserIdUsed,
    usedTimeFormat: persisted ? "HH:mm" : "HH:mm",
    persisted,
    timezoneUsed: tz,
    computed: { start_date: startParts.date, start_time: startParts.timeHM, end_date: endParts.date, end_time: endParts.timeHM },
    readback,
    attempts,
    ...(persisted ? {} : { error: "Lawmatics appointment did not persist times/owner after repair" }),
  };
}

/**
 * Back-compat wrapper: returns the original CreateAppointmentResult shape.
 */
export async function createLawmaticsAppointment(
  accessToken: string,
  opts: CreateAppointmentOptions
): Promise<CreateAppointmentResult> {
  const r = await createOrRepairLawmaticsAppointment(accessToken, opts);

  const missingFields: string[] = [];
  if (!r.createdId) missingFields.push("create_failed");
  if (r.createdId && !r.persisted) missingFields.push("start_time", "end_time");
  if (opts.userId && !pickNumber(r.readback?.user_id)) missingFields.push("user_id");

  return {
    ok: !!r.createdId,
    complete: r.persisted,
    createdId: r.createdId,
    readback: r.readback,
    missingFields,
    attempts: r.attempts.map((a) => ({ step: a.step, status: a.status ?? 0, ok: a.ok, note: a.note })),
    error: r.error,
  };
}
