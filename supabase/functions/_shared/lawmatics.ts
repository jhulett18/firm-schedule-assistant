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

/**
 * Returns the timezone offset in minutes for the given instant in the provided IANA timezone.
 * Example: America/New_York in winter => -300.
 */
export function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  // Build the "wall clock" time in the target timezone, then interpret that as UTC.
  // The difference between that and the actual UTC instant gives the offset.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "1", 10);
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "1", 10);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((asUtcMs - date.getTime()) / 60000);
  return offsetMinutes;
}

/**
 * Format an offset (minutes) as ±HH:MM.
 */
export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Convert an ISO datetime to local ISO datetime including offset in the provided timezone.
 * Output: YYYY-MM-DDTHH:mm:ss±HH:MM
 */
export function toLocalIsoWithOffset(isoDatetime: string, timezone: string): string {
  const d = new Date(isoDatetime);
  const { date, timeHMS } = toLocalDateTimePartsWithSeconds(isoDatetime, timezone);
  const offset = getTimezoneOffsetMinutes(d, timezone);
  return `${date}T${timeHMS}${formatOffset(offset)}`;
}

// ========== JSON:API HELPERS (module-local) ==========

function buildJsonApiRelationship(type: string, id: number | string) {
  return { data: { type, id: String(id) } };
}

function buildEventJsonApiPayload(args: {
  id?: string | number | null;
  attributes: Record<string, any>;
  relationships?: Record<string, any>;
}) {
  const data: Record<string, any> = {
    type: "events",
    attributes: args.attributes,
  };
  if (args.id) data.id = String(args.id);
  if (args.relationships && Object.keys(args.relationships).length > 0) {
    data.relationships = args.relationships;
  }
  return { data };
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

export type LawmaticsTimeFormat = "HH:mm:ss" | "HH:mm" | "h:mm A";

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
    starts_at: string;
    ends_at: string;
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

  // Compute date/time variants in the target timezone
  const startParts = toLocalDateTimePartsWithSeconds(opts.startDatetime, tz);
  const endParts = toLocalDateTimePartsWithSeconds(opts.endDatetime, tz);
  const startPretty = toLocalDateTimeParts(opts.startDatetime, tz);
  const endPretty = toLocalDateTimeParts(opts.endDatetime, tz);

  // Also compute explicit ISO w/ offset (often helps Lawmatics persist)
  const starts_at = toLocalIsoWithOffset(opts.startDatetime, tz);
  const ends_at = toLocalIsoWithOffset(opts.endDatetime, tz);

  const attributesBase: Record<string, any> = {
    name: opts.name,
    description: opts.description,

    start_date: startParts.date,
    end_date: endParts.date,

    all_day: false,
    is_all_day: false,

    // Include ISO timestamps too (in local + offset form)
    starts_at,
    ends_at,
  };

  // Relationships are the canonical way to assign owner/type/location/contact/matter
  const relationships: Record<string, any> = {};

  const relationshipKeys: string[] = [];

  const addRelationship = (key: string, type: string, id: number | string | null) => {
    if (id === null || id === undefined) return;

    const n = pickNumber(id);
    if (n === null) {
      // Keep going, but be explicit.
      relationshipKeys.push(`${key}:invalid`);
      return;
    }

    relationships[key] = buildJsonApiRelationship(type, n);
    relationshipKeys.push(key);
  };

  // Owner
  const ownerUserIdUsed = opts.userId ? pickNumber(opts.userId) : null;
  addRelationship("user", "users", ownerUserIdUsed);

  // Contact
  addRelationship("contact", "contacts", opts.contactId ?? null);

  // Matter
  addRelationship("matter", "matters", opts.matterId ?? null);

  // Event type
  addRelationship("event_type", "event_types", opts.eventTypeId ?? null);

  // Location
  addRelationship("location", "locations", opts.locationId ?? null);

  // Compatibility: also include _id fields in attributes when parseable
  const setCompatAttrId = (key: string, raw: number | string | null | undefined) => {
    const n = raw == null ? null : pickNumber(raw);
    if (n == null) return;
    attributesBase[key] = n;
  };
  setCompatAttrId("user_id", ownerUserIdUsed);
  setCompatAttrId("contact_id", opts.contactId ?? null);
  setCompatAttrId("matter_id", opts.matterId ?? null);
  setCompatAttrId("event_type_id", opts.eventTypeId ?? null);
  setCompatAttrId("location_id", opts.locationId ?? null);

  const variants: Array<{ key: LawmaticsTimeFormat; attrs: Record<string, any> }> = [
    {
      key: "HH:mm:ss",
      attrs: {
        ...attributesBase,
        start_time: startParts.timeHMS,
        end_time: endParts.timeHMS,
      },
    },
    {
      key: "HH:mm",
      attrs: {
        ...attributesBase,
        start_time: startParts.timeHM,
        end_time: endParts.timeHM,
      },
    },
    {
      key: "h:mm A",
      attrs: {
        ...attributesBase,
        start_time: startPretty.time12,
        end_time: endPretty.time12,
      },
    },
  ];

  const isPersisted = (rb: Record<string, any> | null) => {
    if (!rb) return { ok: false, missing: ["readback_null"] as string[] };

    const missing: string[] = [];

    // Time persistence: require BOTH styles to be non-null (helps calendar display)
    if (!rb.start_time) missing.push("start_time");
    if (!rb.end_time) missing.push("end_time");
    if (!rb.starts_at) missing.push("starts_at");
    if (!rb.ends_at) missing.push("ends_at");

    if (ownerUserIdUsed) {
      const rbUser = pickNumber(rb.user_id);
      if (rbUser !== ownerUserIdUsed) missing.push("user_id");
    }

    if (opts.eventTypeId) {
      const expected = pickNumber(opts.eventTypeId);
      const got = pickNumber(rb.event_type_id);
      if (expected != null && got !== expected) missing.push("event_type_id");
    }

    if (opts.locationId) {
      const expected = pickNumber(opts.locationId);
      const got = pickNumber(rb.location_id);
      if (expected != null && got !== expected) missing.push("location_id");
    } else if (opts.requiresLocation) {
      missing.push("location_id");
    }

    return { ok: missing.length === 0, missing };
  };

  await log("lawmatics_payload_computed", "info", "Computed Lawmatics JSON:API payload", {
    timezoneUsed: tz,
    computed: {
      start_date: startParts.date,
      start_time_hms: startParts.timeHMS,
      start_time_hm: startParts.timeHM,
      start_time_12h: startPretty.time12,
      end_date: endParts.date,
      end_time_hms: endParts.timeHMS,
      end_time_hm: endParts.timeHM,
      end_time_12h: endPretty.time12,
      starts_at,
      ends_at,
    },
    relationshipKeys,
  });

  let createdId: string | null = null;
  let lastError: { status: number | null; excerpt?: string; message: string } | null = null;

  // --------- CREATE LOOP (POST) ---------
  for (const v of variants) {
    await log("lawmatics_create_attempt", "info", `Creating Lawmatics event (variant ${v.key})`, {
      variant: v.key,
    });

    try {
      const body = buildEventJsonApiPayload({ attributes: v.attrs, relationships });
      const res = await lawmaticsFetch(accessToken, "POST", "/v1/events", body);
      const { ok, status, json, excerpt } = await lawmaticsJson(res);
      attempts.push({ step: `create_post_${v.key}`, ok, status, note: excerpt || undefined });

      if (!ok) {
        lastError = { status, excerpt, message: `Lawmatics create failed (${status})` };
        continue;
      }

      const id = pickString(json?.data?.id ?? json?.id);
      if (!id) {
        lastError = { status, excerpt, message: "Lawmatics create returned no id" };
        continue;
      }

      createdId = id;

      const readback = await lawmaticsReadEvent(accessToken, createdId);
      const persistedCheck = isPersisted(readback);

      await log(
        "lawmatics_readback_after_create",
        persistedCheck.ok ? "success" : "warn",
        "Lawmatics readback after create",
        {
          event_id: createdId,
          variant: v.key,
          persisted: persistedCheck.ok,
          missingFields: persistedCheck.missing,
          readback,
        }
      );

      if (persistedCheck.ok) {
        return {
          createdId,
          ownerUserIdUsed,
          usedTimeFormat: v.key,
          persisted: true,
          timezoneUsed: tz,
          computed: {
            start_date: startParts.date,
            start_time: String(v.attrs.start_time),
            end_date: endParts.date,
            end_time: String(v.attrs.end_time),
            starts_at,
            ends_at,
          },
          readback,
          attempts,
        };
      }

      // If created but incomplete, we break into repair loop below (keep the first createdId)
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = { status: null, message: `Lawmatics create exception: ${msg}` };
      continue;
    }
  }

  if (!createdId) {
    return {
      createdId: null,
      ownerUserIdUsed,
      usedTimeFormat: "HH:mm:ss",
      persisted: false,
      timezoneUsed: tz,
      computed: {
        start_date: startParts.date,
        start_time: startParts.timeHMS,
        end_date: endParts.date,
        end_time: endParts.timeHMS,
        starts_at,
        ends_at,
      },
      readback: null,
      attempts,
      error: lastError?.excerpt
        ? `${lastError.message}: ${lastError.excerpt}`
        : lastError?.message || "Lawmatics create failed",
    };
  }

  // --------- REPAIR LOOP (PUT) ---------
  for (const v of variants) {
    await log("lawmatics_repair_attempt", "warn", `Repairing Lawmatics event via PUT (variant ${v.key})`, {
      event_id: createdId,
      variant: v.key,
    });

    const body = buildEventJsonApiPayload({ id: createdId, attributes: v.attrs, relationships });
    const put = await lawmaticsUpdateEvent(accessToken, createdId, "PUT", body);
    attempts.push({ step: `repair_put_${v.key}`, ok: put.ok, status: put.status, note: put.excerpt || undefined });

    const readback = await lawmaticsReadEvent(accessToken, createdId);
    const persistedCheck = isPersisted(readback);

    await log(
      "lawmatics_readback_after_repair",
      persistedCheck.ok ? "success" : "error",
      "Lawmatics readback after repair",
      {
        event_id: createdId,
        variant: v.key,
        put_status: put.status,
        put_ok: put.ok,
        put_excerpt: put.excerpt?.slice(0, 500),
        persisted: persistedCheck.ok,
        missingFields: persistedCheck.missing,
        readback,
      }
    );

    if (persistedCheck.ok) {
      return {
        createdId,
        ownerUserIdUsed,
        usedTimeFormat: v.key,
        persisted: true,
        timezoneUsed: tz,
        computed: {
          start_date: startParts.date,
          start_time: String(v.attrs.start_time),
          end_date: endParts.date,
          end_time: String(v.attrs.end_time),
          starts_at,
          ends_at,
        },
        readback,
        attempts,
      };
    }
  }

  const finalReadback = await lawmaticsReadEvent(accessToken, createdId);
  const finalCheck = isPersisted(finalReadback);

  return {
    createdId,
    ownerUserIdUsed,
    usedTimeFormat: "HH:mm:ss",
    persisted: false,
    timezoneUsed: tz,
    computed: {
      start_date: startParts.date,
      start_time: startParts.timeHMS,
      end_date: endParts.date,
      end_time: endParts.timeHMS,
      starts_at,
      ends_at,
    },
    readback: finalReadback,
    attempts,
    error: `Lawmatics appointment created but did not persist required fields: ${finalCheck.missing.join(", ")}`,
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
  if (r.createdId && !r.persisted) missingFields.push("start_time", "end_time", "starts_at", "ends_at");
  if (opts.userId && !pickNumber(r.readback?.user_id)) missingFields.push("user_id");
  if (opts.eventTypeId && !pickNumber(r.readback?.event_type_id)) missingFields.push("event_type_id");
  if ((opts.locationId || opts.requiresLocation) && !pickNumber(r.readback?.location_id)) missingFields.push("location_id");

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
