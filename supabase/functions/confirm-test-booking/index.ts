import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConfirmTestBookingRequest {
  meetingId: string;
  startDatetime: string;
  endDatetime: string;
  runId: string;
}

interface IntegrationError {
  system: "lawmatics" | "google";
  status?: number;
  message: string;
  responseExcerpt?: string;
}

// ========== HELPER UTILITIES ==========

function pickString(v: any): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function pickNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeDateOnly(s: any): string | null {
  const v = pickString(s);
  if (!v) return null;
  return v.includes("T") ? v.slice(0, 10) : v;
}

// ========== LAWMATICS API HELPERS ==========

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

async function lawmaticsJson(res: Response): Promise<{
  ok: boolean;
  status: number;
  json: any | null;
  excerpt: string;
}> {
  const text = await res.text();
  let json: any | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, excerpt: (text || "").slice(0, 300) };
}

// Helper to write progress log
async function writeLog(
  supabase: any,
  meetingId: string,
  runId: string,
  step: string,
  level: string,
  message: string,
  details: Record<string, any> = {}
) {
  await supabase.from("booking_progress_logs").insert({
    meeting_id: meetingId,
    run_id: runId,
    step,
    level,
    message,
    details_json: details,
  });
}

// Convert ISO datetime to local date/time parts
function toLocalDateTimeParts(
  isoDatetime: string,
  timezone: string
): { date: string; time: string; timeSeconds: string; time12: string } {
  const d = new Date(isoDatetime);

  // Date-only: YYYY-MM-DD (no timestamp)
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

  // 12-hour format fallback
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

// ========== LAWMATICS USER RESOLUTION ==========

interface LawmaticsUser {
  id: string;
  email: string | null;
  name: string | null;
  timezone: string | null;
}

async function lawmaticsListUsers(accessToken: string): Promise<{
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
          timezone: pickString(attrs?.time_zone ?? attrs?.timezone ?? attrs?.timeZone),
        });
      }
      
      if (rawUsers.length < perPage) break;
      page++;
      if (page > 10) break;
    }
    
    return { ok: true, users: allUsers };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, users: [], error: msg };
  }
}

async function lawmaticsResolveUserByEmail(
  accessToken: string,
  targetEmail: string | null
): Promise<{
  userId: number | null;
  userIdStr: string | null;
  matchedBy: "email" | "first" | "none";
  user: LawmaticsUser | null;
  timezone: string | null;
}> {
  const result = await lawmaticsListUsers(accessToken);
  
  if (!result.ok || result.users.length === 0) {
    return { userId: null, userIdStr: null, matchedBy: "none", user: null, timezone: null };
  }
  
  const normalizedTarget = (targetEmail || "").trim().toLowerCase();
  
  if (normalizedTarget) {
    const byEmail = result.users.find(u => u.email?.toLowerCase() === normalizedTarget);
    if (byEmail) {
      const numId = pickNumber(byEmail.id);
      return { userId: numId, userIdStr: byEmail.id, matchedBy: "email", user: byEmail, timezone: byEmail.timezone };
    }
  }
  
  const first = result.users[0];
  if (first) {
    const numId = pickNumber(first.id);
    return { userId: numId, userIdStr: first.id, matchedBy: "first", user: first, timezone: first.timezone };
  }
  
  return { userId: null, userIdStr: null, matchedBy: "none", user: null, timezone: null };
}

// ========== LAWMATICS CONTACT OPERATIONS ==========

async function lawmaticsFindOrCreateContact(
  accessToken: string,
  attendee: { email?: string | null; name?: string | null }
): Promise<{
  contactId: number | null;
  contactIdStr: string | null;
  created: boolean;
  error?: string;
}> {
  const email = pickString(attendee?.email);
  if (!email) {
    return { contactId: null, contactIdStr: null, created: false, error: "No email" };
  }

  // 1) Search for existing contact
  try {
    const res = await lawmaticsFetch(accessToken, "GET", `/v1/contacts?search=${encodeURIComponent(email)}&per_page=10`);
    const { ok, json } = await lawmaticsJson(res);

    if (ok) {
      const contacts: any[] = Array.isArray(json?.data) ? json.data : [];
      const normalizedEmail = email.toLowerCase();
      const exactMatch = contacts.find(c => {
        const attrs = c?.attributes ?? c;
        const contactEmail = pickString(attrs?.email);
        return contactEmail?.toLowerCase() === normalizedEmail;
      });
      
      if (exactMatch) {
        const idStr = pickString(exactMatch?.id);
        const idNum = pickNumber(idStr);
        console.log("[Lawmatics] Found existing contact:", idStr);
        return { contactId: idNum, contactIdStr: idStr, created: false };
      }
    }
  } catch (err) {
    console.log("[Lawmatics] contact search exception:", err);
  }

  // 2) Create new contact
  const name = pickString(attendee?.name) || "Test Booking";
  const tokens = name.split(/\s+/).filter(Boolean);
  const first_name = tokens[0] || "Test";
  const last_name = tokens.slice(1).join(" ") || "Booking";

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
    return { contactId: null, contactIdStr: null, created: false, error: msg };
  }
}

// ========== LAWMATICS EVENT OPERATIONS ==========

async function lawmaticsReadEvent(accessToken: string, eventId: string): Promise<Record<string, any> | null> {
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
    const usersRel: any[] = Array.isArray(rel?.users?.data) ? rel.users.data : [];
    const userId = pickString(attrs?.user_id ?? usersRel?.[0]?.id);
    const eventable = rel?.eventable?.data;
    const eventableType = pickString(eventable?.type)?.toLowerCase();
    const contactId = pickString(
      attrs?.contact_id ?? (eventableType?.includes("contact") ? eventable?.id : null)
    );

    return {
      id,
      name: pickString(attrs?.name),
      user_id: userId,
      contact_id: contactId,
      starts_at: pickString(attrs?.starts_at),
      ends_at: pickString(attrs?.ends_at),
      start_date: normalizeDateOnly(attrs?.start_date),
      start_time: pickString(attrs?.start_time),
      end_date: normalizeDateOnly(attrs?.end_date),
      end_time: pickString(attrs?.end_time),
      event_type_id: eventTypeId,
      location_id: locationId,
      all_day: attrs?.all_day,
    };
  } catch (err) {
    console.error("[Lawmatics] read event exception:", err);
    return null;
  }
}

async function lawmaticsUpdateEvent(
  accessToken: string,
  eventId: string,
  method: "PATCH" | "PUT",
  payload: Record<string, any>
): Promise<{ ok: boolean; status: number; excerpt: string }> {
  const res = await lawmaticsFetch(accessToken, method, `/v1/events/${encodeURIComponent(eventId)}`, payload);
  const { ok, status, excerpt } = await lawmaticsJson(res);
  return { ok, status, excerpt };
}

// ========== GOOGLE TOKEN REFRESH ==========

async function refreshAccessToken(
  connectionId: string,
  refreshToken: string,
  supabase: any
): Promise<string | null> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) return null;

    const tokens = await tokenResponse.json();
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabase
      .from("calendar_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return tokens.access_token;
  } catch {
    return null;
  }
}

// ========== MAIN CREATE APPOINTMENT FLOW ==========

interface CreateAppointmentOptions {
  name: string;
  description: string;
  startDatetime: string;
  endDatetime: string;
  timezone: string;
  eventTypeId: number | null;
  locationId: number | null;
  userId: number | null;
  contactId: number | null;
  requiresLocation: boolean;
}

interface CreateAppointmentResult {
  ok: boolean;
  complete: boolean;
  createdId: string | null;
  readback: Record<string, any> | null;
  missingFields: string[];
  attempts: Array<{ step: string; status: number; ok: boolean; note?: string }>;
  error?: string;
}

async function createLawmaticsAppointment(
  accessToken: string,
  opts: CreateAppointmentOptions,
  supabase: any,
  meetingId: string,
  runId: string
): Promise<CreateAppointmentResult> {
  const attempts: Array<{ step: string; status: number; ok: boolean; note?: string }> = [];

  const startParts = toLocalDateTimeParts(opts.startDatetime, opts.timezone);
  const endParts = toLocalDateTimeParts(opts.endDatetime, opts.timezone);

  // Primary payload uses HH:mm
  const canonical: Record<string, any> = {
    name: opts.name,
    description: opts.description,
    all_day: false,
    is_all_day: false,

    // ISO timestamps
    starts_at: opts.startDatetime,
    ends_at: opts.endDatetime,

    // Defensive date/time parts
    start_date: startParts.date, // YYYY-MM-DD
    start_time: startParts.time, // HH:mm
    end_date: endParts.date,
    end_time: endParts.time,
  };

  // Fallback payload uses HH:mm:ss
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

  // Mirror IDs to seconds payload
  for (const k of [
    "event_type_id",
    "location_id",
    "user_id",
    "user_ids",
    "contact_id",
    "eventable_type",
    "eventable_id",
  ]) {
    if (canonical[k] !== undefined) canonicalSeconds[k] = canonical[k];
  }

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
    if (opts.contactId && !rb.contact_id) missing.push("contact_id");

    return missing;
  };

  const postEvent = async (
    step: string,
    payload: any
  ): Promise<{ createdId: string | null; status: number; ok: boolean; excerpt: string }> => {
    const res = await lawmaticsFetch(accessToken, "POST", "/v1/events", payload);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);
    attempts.push({ step, status, ok, note: excerpt || undefined });
    return { createdId: pickString(json?.data?.id ?? json?.id), status, ok, excerpt };
  };

  await writeLog(supabase, meetingId, runId, "lawmatics_create_start", "info", "Creating Lawmatics appointment...", {
    timezoneUsed: opts.timezone,
    computed: {
      start_date: startParts.date,
      start_time: startParts.time,
      start_time_seconds: startParts.timeSeconds,
      end_date: endParts.date,
      end_time: endParts.time,
      end_time_seconds: endParts.timeSeconds,
      starts_at: opts.startDatetime,
      ends_at: opts.endDatetime,
    },
    ids: {
      user_id: opts.userId,
      contact_id: opts.contactId,
      event_type_id: opts.eventTypeId,
      location_id: opts.locationId,
    },
  });

  // Attempt 1: HH:mm payload
  console.log("[Lawmatics] Creating appointment (HH:mm):", JSON.stringify({ ...canonical, description: "..." }));
  let a1 = await postEvent("create_hhmm", canonical);

  // If create failed, try HH:mm:ss payload
  if (!a1.ok) {
    console.log("[Lawmatics] Retry create (HH:mm:ss):", JSON.stringify({ ...canonicalSeconds, description: "..." }));
    a1 = await postEvent("create_hhmmss", canonicalSeconds);
  }

  // If fails, try 12h time format
  if (!a1.ok) {
    const canonical12h = { ...canonical, start_time: startParts.time12, end_time: endParts.time12 };
    console.log("[Lawmatics] Retry create (12h):", startParts.time12);
    a1 = await postEvent("create_12h_time", canonical12h);
  }

  // Try {event: ...} envelope
  if (!a1.ok) {
    console.log("[Lawmatics] Retry create with {event:} envelope");
    a1 = await postEvent("create_event_envelope", { event: canonical });
  }

  // Try {data: ...} envelope
  if (!a1.ok) {
    console.log("[Lawmatics] Retry create with {data:} envelope");
    a1 = await postEvent("create_data_envelope", { data: canonical });
  }

  if (!a1.ok || !a1.createdId) {
    await writeLog(supabase, meetingId, runId, "lawmatics_create_failed", "error", "All create attempts failed", {
      attempts,
      lastExcerpt: a1.excerpt,
    });
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
  let readback = await lawmaticsReadEvent(accessToken, a1.createdId);
  let missingFields = computeMissingFields(readback);

  await writeLog(supabase, meetingId, runId, "lawmatics_readback", "info", "Appointment readback", {
    event_id: a1.createdId,
    readback,
    missingFields,
  });

  // If missing times specifically, try to repair with HH:mm:ss first
  const missingTimes = missingFields.includes("start_time") || missingFields.includes("end_time");

  if (missingTimes) {
    await writeLog(supabase, meetingId, runId, "lawmatics_repair_times", "warn", "Readback missing time fields; attempting HH:mm:ss repair", {
      event_id: a1.createdId,
      computed: {
        start_date: startParts.date,
        start_time: startParts.time,
        start_time_seconds: startParts.timeSeconds,
        end_date: endParts.date,
        end_time: endParts.time,
        end_time_seconds: endParts.timeSeconds,
      },
    });

    const patchSeconds = await lawmaticsUpdateEvent(accessToken, a1.createdId, "PATCH", canonicalSeconds);
    attempts.push({ step: "patch_repair_hhmmss", status: patchSeconds.status, ok: patchSeconds.ok, note: patchSeconds.excerpt });

    readback = await lawmaticsReadEvent(accessToken, a1.createdId);
    missingFields = computeMissingFields(readback);

    await writeLog(supabase, meetingId, runId, "lawmatics_repair_times_readback", "info", "After HH:mm:ss repair", {
      readback,
      missingFields,
    });
  }

  if (missingFields.length === 0) {
    await writeLog(supabase, meetingId, runId, "lawmatics_success", "success", "Appointment created and verified complete", {
      event_id: a1.createdId,
    });
    return { ok: true, complete: true, createdId: a1.createdId, readback, missingFields: [], attempts };
  }

  console.log("[Lawmatics] Appointment incomplete, missing:", missingFields, "- attempting repair");

  // Try PATCH repair (original canonical)
  const patchResult = await lawmaticsUpdateEvent(accessToken, a1.createdId, "PATCH", canonical);
  attempts.push({ step: "patch_repair", status: patchResult.status, ok: patchResult.ok, note: patchResult.excerpt });

  if (patchResult.ok) {
    const readback2 = await lawmaticsReadEvent(accessToken, a1.createdId);
    const missing2 = computeMissingFields(readback2);

    await writeLog(supabase, meetingId, runId, "lawmatics_patch_readback", "info", "After PATCH repair", {
      readback: readback2,
      missingFields: missing2,
    });

    if (missing2.length === 0) {
      await writeLog(supabase, meetingId, runId, "lawmatics_success", "success", "Appointment repaired via PATCH", {
        event_id: a1.createdId,
      });
      return { ok: true, complete: true, createdId: a1.createdId, readback: readback2, missingFields: [], attempts };
    }

    // Try PUT if PATCH didn't fully fix it
    const putResult = await lawmaticsUpdateEvent(accessToken, a1.createdId, "PUT", canonical);
    attempts.push({ step: "put_repair", status: putResult.status, ok: putResult.ok, note: putResult.excerpt });

    if (putResult.ok) {
      const readback3 = await lawmaticsReadEvent(accessToken, a1.createdId);
      const missing3 = computeMissingFields(readback3);

      await writeLog(supabase, meetingId, runId, "lawmatics_put_readback", "info", "After PUT repair", {
        readback: readback3,
        missingFields: missing3,
      });

      if (missing3.length === 0) {
        await writeLog(supabase, meetingId, runId, "lawmatics_success", "success", "Appointment repaired via PUT", {
          event_id: a1.createdId,
        });
        return { ok: true, complete: true, createdId: a1.createdId, readback: readback3, missingFields: [], attempts };
      }

      return { ok: true, complete: false, createdId: a1.createdId, readback: readback3, missingFields: missing3, attempts };
    }
  }

  await writeLog(supabase, meetingId, runId, "lawmatics_incomplete", "warn", "Created but incomplete after repairs", {
    event_id: a1.createdId,
    missingFields,
    readback,
  });

  return { ok: true, complete: false, createdId: a1.createdId, readback, missingFields, attempts };
}

// ========== MAIN HANDLER ==========

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const errors: IntegrationError[] = [];

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body: ConfirmTestBookingRequest = await req.json();
    const { meetingId, startDatetime, endDatetime, runId } = body;

    if (!meetingId || !startDatetime || !endDatetime || !runId) {
      return new Response(JSON.stringify({ success: false, error: { message: "Missing required fields" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await writeLog(supabase, meetingId, runId, "start", "info", "Starting test booking confirmation...");

    // Fetch meeting with all relations
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select(`
        *,
        meeting_types (name, lawmatics_event_type_id),
        rooms (name, resource_email, lawmatics_location_id)
      `)
      .eq("id", meetingId)
      .single();

    if (meetingError || !meeting) {
      await writeLog(supabase, meetingId, runId, "error", "error", "Meeting not found", { error: meetingError?.message });
      return new Response(JSON.stringify({ success: false, error: { message: "Meeting not found" } }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preferences = meeting.preferences as Record<string, any> || {};
    const isTest = preferences.is_test === true;
    const adminCalendarId = preferences.admin_calendar_id;
    const sendInvites = preferences.send_invites === true;
    const meetingTimezone = meeting.timezone || "America/New_York";

    if (!isTest) {
      await writeLog(supabase, meetingId, runId, "error", "error", "Not a test booking");
      return new Response(JSON.stringify({ success: false, error: { message: "Not a test booking" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch host attorney
    let hostAttorney: { id: string; name: string; email: string } | null = null;
    if (meeting.host_attorney_user_id) {
      const { data: attorney } = await supabase
        .from("users")
        .select("id, name, email")
        .eq("id", meeting.host_attorney_user_id)
        .single();
      hostAttorney = attorney;
    }

    await writeLog(supabase, meetingId, runId, "meeting_update", "info", "Updating meeting status to Booked...");

    // Update meeting status
    const { error: updateMeetingError } = await supabase
      .from("meetings")
      .update({
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        status: "Booked",
        updated_at: new Date().toISOString(),
      })
      .eq("id", meetingId);

    if (updateMeetingError) {
      await writeLog(supabase, meetingId, runId, "meeting_update", "error", "Failed to update meeting", { error: updateMeetingError.message });
      throw new Error("Failed to update meeting");
    }

    await writeLog(supabase, meetingId, runId, "meeting_update", "success", "Meeting status updated to Booked");

    // Update booking request if exists
    if (meeting.booking_request_id) {
      await supabase.from("booking_requests").update({ status: "Completed" }).eq("id", meeting.booking_request_id);
    }

    // ========== LAWMATICS INTEGRATION ==========
    let lawmaticsAppointmentId: string | null = null;
    let lawmaticsReadback: Record<string, any> | null = null;
    let lawmaticsComplete = false;

    await writeLog(supabase, meetingId, runId, "lawmatics_start", "info", "Checking Lawmatics connection...");

    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lawmaticsConnection?.access_token) {
      const lawmaticsAccessToken = lawmaticsConnection.access_token;
      
      // Step 1: Resolve Lawmatics host user by email
      await writeLog(supabase, meetingId, runId, "lawmatics_resolve_host", "info", "Resolving Lawmatics host user by email...", {
        host_email: hostAttorney?.email,
      });
      
      const hostResult = await lawmaticsResolveUserByEmail(lawmaticsAccessToken, hostAttorney?.email || null);
      
      if (hostResult.userId) {
        await writeLog(supabase, meetingId, runId, "lawmatics_host_resolved", "success", "Lawmatics host user resolved", {
          lawmatics_user_id: hostResult.userId,
          matched_by: hostResult.matchedBy,
          user_name: hostResult.user?.name,
          user_email: hostResult.user?.email,
          user_timezone: hostResult.timezone,
        });
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_host_failed", "warn", "Could not resolve Lawmatics host user - appointment may not be assigned");
      }
      
      // Determine timezone
      const effectiveTimezone = hostResult.timezone || meetingTimezone || "America/New_York";
      await writeLog(supabase, meetingId, runId, "lawmatics_timezone", "info", "Using timezone", {
        effective: effectiveTimezone,
        lawmatics_user_tz: hostResult.timezone,
        meeting_tz: meetingTimezone,
      });
      
      // Step 2: Find or create contact for attendee
      const externalAttendee = (meeting.external_attendees as any[])?.[0];
      const attendeeEmail = externalAttendee?.email || hostAttorney?.email || user.email;
      const attendeeName = externalAttendee?.name || hostAttorney?.name || user.email?.split("@")[0] || "Test User";
      
      await writeLog(supabase, meetingId, runId, "lawmatics_contact_start", "info", "Upserting Lawmatics contact for attendee...", {
        attendee_email: attendeeEmail,
        attendee_name: attendeeName,
      });
      
      const contactResult = await lawmaticsFindOrCreateContact(lawmaticsAccessToken, {
        email: attendeeEmail,
        name: attendeeName,
      });
      
      if (contactResult.contactId) {
        await writeLog(supabase, meetingId, runId, "lawmatics_contact_resolved", "success", `Lawmatics contact ${contactResult.created ? "created" : "found"}`, {
          contact_id: contactResult.contactId,
          created: contactResult.created,
        });
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_contact_failed", "warn", "Could not upsert Lawmatics contact", {
          error: contactResult.error,
        });
      }
      
      // Log mapping warnings
      if (!meeting.meeting_types?.lawmatics_event_type_id) {
        await writeLog(supabase, meetingId, runId, "lawmatics_mapping_warn", "warn", "No lawmatics_event_type_id mapped for this meeting type");
      }
      if (meeting.location_mode === "InPerson" && !meeting.rooms?.lawmatics_location_id) {
        await writeLog(supabase, meetingId, runId, "lawmatics_mapping_warn", "warn", "No lawmatics_location_id mapped for this room");
      }
      
      // Step 3: Create the appointment
      const eventName = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${attendeeName} - ${hostAttorney?.name || "Attorney"}`;
      const descriptionParts = [
        "⚠️ TEST BOOKING - Created from Admin Test My Booking",
        "",
        `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
        `Duration: ${meeting.duration_minutes} minutes`,
        `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
        hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
        attendeeEmail ? `Attendee: ${attendeeName} (${attendeeEmail})` : null,
      ].filter(Boolean).join("\n");
      
      await writeLog(supabase, meetingId, runId, "lawmatics_create_appointment", "info", "Creating Lawmatics appointment...");
      
      const appointmentResult = await createLawmaticsAppointment(
        lawmaticsAccessToken,
        {
          name: eventName,
          description: descriptionParts,
          startDatetime,
          endDatetime,
          timezone: effectiveTimezone,
          eventTypeId: pickNumber(meeting.meeting_types?.lawmatics_event_type_id),
          locationId: meeting.location_mode === "InPerson" ? pickNumber(meeting.rooms?.lawmatics_location_id) : null,
          userId: hostResult.userId,
          contactId: contactResult.contactId,
          requiresLocation: meeting.location_mode === "InPerson",
        },
        supabase,
        meetingId,
        runId
      );
      
      lawmaticsAppointmentId = appointmentResult.createdId;
      lawmaticsReadback = appointmentResult.readback;
      lawmaticsComplete = appointmentResult.complete;
      
      if (appointmentResult.ok && appointmentResult.createdId) {
        if (appointmentResult.complete) {
          await writeLog(supabase, meetingId, runId, "lawmatics_final", "success", "Lawmatics appointment created and verified complete", {
            event_id: appointmentResult.createdId,
          });
        } else {
          await writeLog(supabase, meetingId, runId, "lawmatics_final", "warn", "Lawmatics appointment created but INCOMPLETE", {
            event_id: appointmentResult.createdId,
            missingFields: appointmentResult.missingFields,
            readback: appointmentResult.readback,
          });
          errors.push({
            system: "lawmatics",
            message: `Created (incomplete) - missing: ${appointmentResult.missingFields.join(", ")}`,
          });
        }
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_final", "error", "Lawmatics appointment creation failed", {
          error: appointmentResult.error,
          attempts: appointmentResult.attempts,
        });
        errors.push({
          system: "lawmatics",
          message: appointmentResult.error || "Create failed",
        });
      }
    } else {
      await writeLog(supabase, meetingId, runId, "lawmatics_skip", "warn", "No Lawmatics connection configured");
    }

    // Store Lawmatics ID if created
    if (lawmaticsAppointmentId) {
      await supabase
        .from("meetings")
        .update({ lawmatics_appointment_id: lawmaticsAppointmentId })
        .eq("id", meetingId);
    }

    // ========== GOOGLE CALENDAR INTEGRATION ==========
    await writeLog(supabase, meetingId, runId, "google_start", "info", "Creating Google Calendar event...");

    const { data: calendarConnection } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", meeting.host_attorney_user_id)
      .eq("provider", "google")
      .maybeSingle();

    let googleEventId: string | null = null;

    if (calendarConnection && adminCalendarId) {
      try {
        let accessToken = calendarConnection.access_token;

        // Refresh token if needed
        const tokenExpiresAt = calendarConnection.token_expires_at ? new Date(calendarConnection.token_expires_at) : null;
        if (tokenExpiresAt && tokenExpiresAt < new Date() && calendarConnection.refresh_token) {
          const refreshed = await refreshAccessToken(calendarConnection.id, calendarConnection.refresh_token, supabase);
          if (refreshed) accessToken = refreshed;
        }

        const externalAttendee = (meeting.external_attendees as any[])?.[0];
        const eventSummary = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${externalAttendee?.name || "Test"} - ${hostAttorney?.name || "Attorney"}`;

        const attendees: { email: string; resource?: boolean }[] = [];
        if (hostAttorney?.email) attendees.push({ email: hostAttorney.email });
        if (externalAttendee?.email) attendees.push({ email: externalAttendee.email });
        if (meeting.rooms?.resource_email) attendees.push({ email: meeting.rooms.resource_email, resource: true });

        const eventBody = {
          summary: eventSummary,
          description: `⚠️ TEST BOOKING\n\nMeeting Type: ${meeting.meeting_types?.name || "Meeting"}\nRoom: ${meeting.rooms?.name || "N/A"}`,
          start: { dateTime: startDatetime, timeZone: meetingTimezone },
          end: { dateTime: endDatetime, timeZone: meetingTimezone },
          attendees,
        };

        const sendUpdatesParam = sendInvites ? "all" : "none";
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(adminCalendarId)}/events?sendUpdates=${sendUpdatesParam}`;

        await writeLog(supabase, meetingId, runId, "google_request", "info", `Posting to calendar: ${adminCalendarId}`, {
          sendUpdates: sendUpdatesParam,
          attendeeCount: attendees.length,
        });

        const calendarResponse = await fetch(calendarUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        });

        if (calendarResponse.ok) {
          const eventData = await calendarResponse.json();
          googleEventId = eventData.id;
          await writeLog(supabase, meetingId, runId, "google_success", "success", "Google Calendar event created", {
            eventId: googleEventId,
            htmlLink: eventData.htmlLink,
          });
        } else {
          const errorText = await calendarResponse.text();
          errors.push({
            system: "google",
            status: calendarResponse.status,
            message: `Google Calendar API error: ${calendarResponse.status}`,
            responseExcerpt: errorText.slice(0, 500),
          });
          await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar API error", {
            status: calendarResponse.status,
            error: errorText.slice(0, 500),
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        errors.push({ system: "google", message: errorMessage });
        await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar exception", { error: errorMessage });
      }
    } else {
      await writeLog(supabase, meetingId, runId, "google_skip", "warn", "No Google calendar connection or calendar ID");
    }

    // Store Google event ID if created
    if (googleEventId) {
      await supabase
        .from("meetings")
        .update({ m365_event_id: googleEventId })
        .eq("id", meetingId);
    }

    // Final summary
    const overallSuccess = errors.filter(e => e.system === "lawmatics" && !e.message.includes("incomplete")).length === 0 &&
                          errors.filter(e => e.system === "google").length === 0;

    await writeLog(supabase, meetingId, runId, "done", overallSuccess ? "success" : "warn", "Test booking confirmation complete", {
      lawmatics_id: lawmaticsAppointmentId,
      lawmatics_complete: lawmaticsComplete,
      google_id: googleEventId,
      errors: errors.length > 0 ? errors : undefined,
    });

    const lawmaticsDebug = {
      timezoneUsed: (lawmaticsReadback ? undefined : undefined) as any, // placeholder removed below
    };

    return new Response(JSON.stringify({
      success: overallSuccess,
      lawmaticsAppointmentId,
      lawmaticsComplete,
      lawmaticsReadback,
      lawmaticsDebug: {
        timezoneUsed: (lawmaticsReadback?._attributes?.time_zone || lawmaticsReadback?._attributes?.timezone) ?? undefined,
        computed: {
          // The authoritative computed values are logged in booking_progress_logs at step "lawmatics_create_start"
          // We echo the meeting timezone here for quick visibility.
          meetingTimezone,
        },
        readback: lawmaticsReadback,
      },
      googleEventId,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in confirm-test-booking:", error);
    return new Response(JSON.stringify({
      success: false,
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      errors,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
