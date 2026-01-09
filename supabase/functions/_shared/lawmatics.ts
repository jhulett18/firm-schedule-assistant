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

// ========== APPOINTMENT CREATION WITH MULTI-VARIANT RETRY AND REPAIR ==========

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

export type LawmaticsTimeFormat = "12h_seconds" | "12h" | "24h_seconds" | "24h";

export type CreateOrRepairAppointmentResult = {
  createdId: string | null;
  ownerUserIdUsed: number | null;
  usedTimeFormat: LawmaticsTimeFormat | null;
  winningVariant: string | null;
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
  attemptedVariants: string[];
  readback: Record<string, any> | null;
  attempts: Array<{ step: string; status: number | null; ok: boolean; note?: string }>;
  error?: string;
};

/**
 * Create a Lawmatics appointment with comprehensive multi-variant retry and PATCH repair.
 * 
 * Strategy:
 * 1. Compute datetime strings in multiple formats (12h, 24h, with/without seconds)
 * 2. Try multiple payload structures (flat vs {event:...} wrapped)
 * 3. Use full ISO starts_at/ends_at AND date/time fields redundantly
 * 4. If creation succeeds but readback is incomplete, attempt PATCH repair
 * 5. Return detailed debug info about which variant worked
 */
export async function createOrRepairLawmaticsAppointment(
  accessToken: string,
  opts: CreateAppointmentOptions,
  progress?: BookingProgressLogger
): Promise<CreateOrRepairAppointmentResult> {
  const attempts: Array<{ step: string; status: number | null; ok: boolean; note?: string }> = [];
  const attemptedVariants: string[] = [];

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

  // ========== COMPUTE DATETIME STRINGS ==========
  const startParts = toLocalDateTimeParts(opts.startDatetime, tz);
  const endParts = toLocalDateTimeParts(opts.endDatetime, tz);
  
  // Full ISO with Z suffix (UTC)
  const startISO = new Date(opts.startDatetime).toISOString();
  const endISO = new Date(opts.endDatetime).toISOString();
  
  // ISO with local offset
  const starts_at_offset = toLocalIsoWithOffset(opts.startDatetime, tz);
  const ends_at_offset = toLocalIsoWithOffset(opts.endDatetime, tz);

  // Time format variants
  const timeFormats: Record<LawmaticsTimeFormat, { start: string; end: string }> = {
    "12h_seconds": { start: startParts.time12Seconds, end: endParts.time12Seconds },
    "12h": { start: startParts.time12, end: endParts.time12 },
    "24h_seconds": { start: startParts.timeSeconds, end: endParts.timeSeconds },
    "24h": { start: startParts.time, end: endParts.time },
  };

  // Validate and coerce IDs
  const ownerUserIdUsed = opts.userId ? pickNumber(opts.userId) : null;
  const eventTypeId = opts.eventTypeId ? pickNumber(opts.eventTypeId) : null;
  const locationId = opts.locationId ? pickNumber(opts.locationId) : null;
  const contactId = opts.contactId ? pickNumber(opts.contactId) : null;
  const matterId = opts.matterId ? pickNumber(opts.matterId) : null;

  // Build base payload attributes (common to all variants)
  const buildBasePayload = (timeFormat: LawmaticsTimeFormat, startDateValue: string, endDateValue: string) => {
    const times = timeFormats[timeFormat];
    const payload: Record<string, any> = {
      name: opts.name,
      description: opts.description,
      all_day: false,
      is_all_day: false,
      
      // ISO timestamps - include multiple forms for maximum compatibility
      starts_at: startISO,
      ends_at: endISO,
      
      // Date parts
      start_date: startDateValue,
      end_date: endDateValue,
      
      // Time parts
      start_time: times.start,
      end_time: times.end,
    };

    // Add IDs as NUMBERS
    if (ownerUserIdUsed != null) {
      payload.user_id = ownerUserIdUsed;
      payload.user_ids = [ownerUserIdUsed];
    }
    if (eventTypeId != null) payload.event_type_id = eventTypeId;
    if (locationId != null) payload.location_id = locationId;
    if (contactId != null) {
      payload.contact_id = contactId;
      payload.eventable_type = "Contact";
      payload.eventable_id = contactId;
    }
    if (matterId != null) payload.matter_id = matterId;

    return payload;
  };

  // Define variants to try
  // Each variant has: time format, start_date format, wrapper style
  const variants: Array<{
    key: string;
    timeFormat: LawmaticsTimeFormat;
    startDateValue: string;
    endDateValue: string;
    wrapper: "flat" | "event" | "data";
  }> = [
    // Variant A: 12h time, full ISO start_date, flat
    { key: "A-12h-iso-flat", timeFormat: "12h_seconds", startDateValue: startISO, endDateValue: endISO, wrapper: "flat" },
    // Variant B: 24h time, full ISO start_date, flat
    { key: "B-24h-iso-flat", timeFormat: "24h_seconds", startDateValue: startISO, endDateValue: endISO, wrapper: "flat" },
    // Variant C: 12h time, date-only, flat
    { key: "C-12h-dateonly-flat", timeFormat: "12h_seconds", startDateValue: startParts.date, endDateValue: endParts.date, wrapper: "flat" },
    // Variant D: 24h time, date-only, flat
    { key: "D-24h-dateonly-flat", timeFormat: "24h_seconds", startDateValue: startParts.date, endDateValue: endParts.date, wrapper: "flat" },
    // Variant E: 12h (no seconds), date-only, flat
    { key: "E-12h-nosec-flat", timeFormat: "12h", startDateValue: startParts.date, endDateValue: endParts.date, wrapper: "flat" },
    // Variant F: 24h (no seconds), date-only, flat
    { key: "F-24h-nosec-flat", timeFormat: "24h", startDateValue: startParts.date, endDateValue: endParts.date, wrapper: "flat" },
    // Variant G: 12h, ISO, {event:} wrapped
    { key: "G-12h-iso-event", timeFormat: "12h_seconds", startDateValue: startISO, endDateValue: endISO, wrapper: "event" },
    // Variant H: 24h, date-only, {event:} wrapped  
    { key: "H-24h-dateonly-event", timeFormat: "24h_seconds", startDateValue: startParts.date, endDateValue: endParts.date, wrapper: "event" },
  ];

  await log("lawmatics_payload_computed", "info", "Computed Lawmatics datetime strings", {
    timezoneUsed: tz,
    startISO,
    endISO,
    starts_at_offset,
    ends_at_offset,
    start_date_dateonly: startParts.date,
    time_12h: timeFormats["12h"].start,
    time_12h_seconds: timeFormats["12h_seconds"].start,
    time_24h: timeFormats["24h"].start,
    time_24h_seconds: timeFormats["24h_seconds"].start,
    ownerUserIdUsed,
    eventTypeId,
    locationId,
    contactId,
    variantCount: variants.length,
  });

  // ========== CHECK IF READBACK IS COMPLETE ==========
  const isPersisted = (rb: Record<string, any> | null): { ok: boolean; missing: string[] } => {
    if (!rb) return { ok: false, missing: ["readback_null"] };

    const missing: string[] = [];

    // Time persistence: need EITHER starts_at/ends_at OR start_time/end_time
    const hasStartsAt = !!rb.starts_at;
    const hasEndsAt = !!rb.ends_at;
    const hasStartTime = !!rb.start_time;
    const hasEndTime = !!rb.end_time;
    
    if (!hasStartsAt && !hasStartTime) missing.push("start_time");
    if (!hasEndsAt && !hasEndTime) missing.push("end_time");

    if (ownerUserIdUsed) {
      const rbUser = pickNumber(rb.user_id);
      if (rbUser == null) missing.push("user_id");
    }

    if (eventTypeId) {
      const got = pickNumber(rb.event_type_id);
      if (got == null) missing.push("event_type_id");
    }

    if (locationId || opts.requiresLocation) {
      const got = pickNumber(rb.location_id);
      if (got == null && opts.requiresLocation) missing.push("location_id");
    }

    return { ok: missing.length === 0, missing };
  };

  let createdId: string | null = null;
  let winningVariant: string | null = null;
  let usedTimeFormat: LawmaticsTimeFormat | null = null;
  let lastError: { status: number | null; excerpt?: string; message: string } | null = null;

  // ========== CREATE LOOP (try each variant until success) ==========
  for (const v of variants) {
    attemptedVariants.push(v.key);
    
    const basePayload = buildBasePayload(v.timeFormat, v.startDateValue, v.endDateValue);
    
    let body: any;
    if (v.wrapper === "event") {
      body = { event: basePayload };
    } else if (v.wrapper === "data") {
      body = { data: basePayload };
    } else {
      body = basePayload;
    }

    await log("lawmatics_create_attempt", "info", `Attempting Lawmatics create (variant ${v.key})`, {
      variant: v.key,
      timeFormat: v.timeFormat,
      startDateValue: v.startDateValue,
      wrapper: v.wrapper,
    });

    try {
      const res = await lawmaticsFetch(accessToken, "POST", "/v1/events", body);
      const { ok, status, json, excerpt } = await lawmaticsJson(res);
      attempts.push({ step: `create_${v.key}`, ok, status, note: excerpt?.slice(0, 200) || undefined });

      if (!ok) {
        lastError = { status, excerpt, message: `Lawmatics create failed (${status}): ${excerpt?.slice(0, 100)}` };
        console.log(`[Lawmatics] Variant ${v.key} failed:`, status, excerpt?.slice(0, 200));
        continue;
      }

      const id = pickString(json?.data?.id ?? json?.id);
      if (!id) {
        lastError = { status, excerpt, message: "Lawmatics create returned no id" };
        console.log(`[Lawmatics] Variant ${v.key} returned no id`);
        continue;
      }

      createdId = id;
      winningVariant = v.key;
      usedTimeFormat = v.timeFormat;

      console.log(`[Lawmatics] Created event ID ${id} with variant ${v.key}`);

      // Check readback
      const readback = await lawmaticsReadEvent(accessToken, createdId);
      const persistedCheck = isPersisted(readback);

      await log(
        "lawmatics_readback_after_create",
        persistedCheck.ok ? "success" : "warn",
        `Lawmatics readback after create (variant ${v.key})`,
        {
          event_id: createdId,
          variant: v.key,
          persisted: persistedCheck.ok,
          missingFields: persistedCheck.missing,
          readback: {
            starts_at: readback?.starts_at,
            ends_at: readback?.ends_at,
            start_date: readback?.start_date,
            start_time: readback?.start_time,
            end_date: readback?.end_date,
            end_time: readback?.end_time,
            user_id: readback?.user_id,
            event_type_id: readback?.event_type_id,
            location_id: readback?.location_id,
          },
        }
      );

      if (persistedCheck.ok) {
        // Success! Everything persisted
        return {
          createdId,
          ownerUserIdUsed,
          usedTimeFormat,
          winningVariant,
          persisted: true,
          timezoneUsed: tz,
          computed: {
            start_date: v.startDateValue,
            start_time: timeFormats[v.timeFormat].start,
            end_date: v.endDateValue,
            end_time: timeFormats[v.timeFormat].end,
            starts_at: startISO,
            ends_at: endISO,
          },
          attemptedVariants,
          readback,
          attempts,
        };
      }

      // Created but incomplete - break to repair loop
      console.log(`[Lawmatics] Variant ${v.key} created but missing:`, persistedCheck.missing);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = { status: null, message: `Lawmatics create exception: ${msg}` };
      attempts.push({ step: `create_${v.key}`, ok: false, status: null, note: msg });
      console.error(`[Lawmatics] Variant ${v.key} exception:`, msg);
      continue;
    }
  }

  // ========== CREATION FAILED COMPLETELY ==========
  if (!createdId) {
    await log("lawmatics_create_failed", "error", "All Lawmatics create variants failed", {
      attemptedVariants,
      lastError,
      attempts: attempts.slice(-8),
    });

    return {
      createdId: null,
      ownerUserIdUsed,
      usedTimeFormat: null,
      winningVariant: null,
      persisted: false,
      timezoneUsed: tz,
      computed: {
        start_date: startParts.date,
        start_time: startParts.timeSeconds,
        end_date: endParts.date,
        end_time: endParts.timeSeconds,
        starts_at: startISO,
        ends_at: endISO,
      },
      attemptedVariants,
      readback: null,
      attempts,
      error: lastError?.excerpt
        ? `${lastError.message}`
        : lastError?.message || "Lawmatics create failed (all variants)",
    };
  }

  // ========== REPAIR LOOP (PATCH with minimal payloads) ==========
  await log("lawmatics_repair_start", "warn", "Lawmatics event created but incomplete; attempting PATCH repair", {
    event_id: createdId,
    winningVariant,
  });

  // Try PATCH with minimal payloads in different formats
  const repairPayloads: Array<{ key: string; payload: Record<string, any> }> = [
    // Minimal: just times + core IDs
    {
      key: "repair-minimal-12h",
      payload: {
        starts_at: startISO,
        ends_at: endISO,
        start_time: timeFormats["12h_seconds"].start,
        end_time: timeFormats["12h_seconds"].end,
        all_day: false,
        is_all_day: false,
        ...(ownerUserIdUsed != null && { user_id: ownerUserIdUsed }),
        ...(eventTypeId != null && { event_type_id: eventTypeId }),
        ...(locationId != null && { location_id: locationId }),
      },
    },
    {
      key: "repair-minimal-24h",
      payload: {
        starts_at: startISO,
        ends_at: endISO,
        start_time: timeFormats["24h_seconds"].start,
        end_time: timeFormats["24h_seconds"].end,
        all_day: false,
        is_all_day: false,
        ...(ownerUserIdUsed != null && { user_id: ownerUserIdUsed }),
        ...(eventTypeId != null && { event_type_id: eventTypeId }),
        ...(locationId != null && { location_id: locationId }),
      },
    },
    // Try with {event:} wrapper
    {
      key: "repair-event-wrapped",
      payload: {
        event: {
          starts_at: startISO,
          ends_at: endISO,
          start_time: timeFormats["12h"].start,
          end_time: timeFormats["12h"].end,
          all_day: false,
          ...(ownerUserIdUsed != null && { user_id: ownerUserIdUsed }),
        },
      },
    },
  ];

  for (const rp of repairPayloads) {
    attemptedVariants.push(`PATCH:${rp.key}`);

    await log("lawmatics_repair_attempt", "info", `Attempting PATCH repair (${rp.key})`, {
      event_id: createdId,
      repair_key: rp.key,
    });

    try {
      const patchResult = await lawmaticsUpdateEvent(accessToken, createdId, "PATCH", rp.payload);
      attempts.push({ step: rp.key, ok: patchResult.ok, status: patchResult.status, note: patchResult.excerpt?.slice(0, 200) });

      if (!patchResult.ok) {
        console.log(`[Lawmatics] PATCH ${rp.key} failed:`, patchResult.status, patchResult.excerpt?.slice(0, 100));
        continue;
      }

      const readback = await lawmaticsReadEvent(accessToken, createdId);
      const persistedCheck = isPersisted(readback);

      await log(
        "lawmatics_readback_after_repair",
        persistedCheck.ok ? "success" : "warn",
        `Lawmatics readback after PATCH repair (${rp.key})`,
        {
          event_id: createdId,
          repair_key: rp.key,
          persisted: persistedCheck.ok,
          missingFields: persistedCheck.missing,
          readback: {
            starts_at: readback?.starts_at,
            ends_at: readback?.ends_at,
            start_time: readback?.start_time,
            end_time: readback?.end_time,
            user_id: readback?.user_id,
          },
        }
      );

      if (persistedCheck.ok) {
        return {
          createdId,
          ownerUserIdUsed,
          usedTimeFormat,
          winningVariant: `${winningVariant}+${rp.key}`,
          persisted: true,
          timezoneUsed: tz,
          computed: {
            start_date: startParts.date,
            start_time: timeFormats[usedTimeFormat || "12h_seconds"].start,
            end_date: endParts.date,
            end_time: timeFormats[usedTimeFormat || "12h_seconds"].end,
            starts_at: startISO,
            ends_at: endISO,
          },
          attemptedVariants,
          readback,
          attempts,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ step: rp.key, ok: false, status: null, note: msg });
      console.error(`[Lawmatics] PATCH ${rp.key} exception:`, msg);
    }
  }

  // ========== REPAIR FAILED - return incomplete ==========
  const finalReadback = await lawmaticsReadEvent(accessToken, createdId);
  const finalCheck = isPersisted(finalReadback);

  await log("lawmatics_repair_failed", "error", "Lawmatics event created but repairs did not persist required fields", {
    event_id: createdId,
    missingFields: finalCheck.missing,
    readback: finalReadback,
    attemptedVariants,
  });

  return {
    createdId,
    ownerUserIdUsed,
    usedTimeFormat,
    winningVariant,
    persisted: false,
    timezoneUsed: tz,
    computed: {
      start_date: startParts.date,
      start_time: startParts.timeSeconds,
      end_date: endParts.date,
      end_time: endParts.timeSeconds,
      starts_at: startISO,
      ends_at: endISO,
    },
    attemptedVariants,
    readback: finalReadback,
    attempts,
    error: `Lawmatics event created but did not persist required fields: ${finalCheck.missing.join(", ")}`,
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
  if (r.createdId && !r.persisted) {
    if (!r.readback?.start_time && !r.readback?.starts_at) missingFields.push("start_time");
    if (!r.readback?.end_time && !r.readback?.ends_at) missingFields.push("end_time");
  }
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
