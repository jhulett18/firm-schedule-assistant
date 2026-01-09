import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lawmaticsFetch, lawmaticsJson } from "../_shared/lawmatics.ts";

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

// Helper to convert ISO datetime to date/time parts in a given timezone
function toLocalDateTimeParts(isoDatetime: string, timezone: string): { date: string; time: string } {
  const date = new Date(isoDatetime);
  
  // Get date in YYYY-MM-DD format using en-CA locale (gives ISO format reliably)
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  
  const year = dateParts.find(p => p.type === 'year')?.value || '';
  const month = dateParts.find(p => p.type === 'month')?.value || '';
  const day = dateParts.find(p => p.type === 'day')?.value || '';
  const dateStr = `${year}-${month}-${day}`;
  
  // Get time in HH:mm format using en-GB locale with 24h format
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  
  const hour = timeParts.find(p => p.type === 'hour')?.value || '00';
  const minute = timeParts.find(p => p.type === 'minute')?.value || '00';
  const timeStr = `${hour}:${minute}`;
  
  return { date: dateStr, time: timeStr };
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

// ========== LAWMATICS HELPERS ==========

type LawmaticsMe = { userId: string | null; timezone: string | null };

type Attendee = {
  email?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

function pickString(v: any): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function normalizeDateOnly(s: any): string | null {
  const v = pickString(s);
  if (!v) return null;
  // If Lawmatics returns an ISO-ish timestamp for start_date, normalize to YYYY-MM-DD
  return v.includes("T") ? v.slice(0, 10) : v;
}

async function lawmaticsGetMe(accessToken: string): Promise<LawmaticsMe> {
  try {
    const res = await lawmaticsFetch(accessToken, "GET", "/v1/users/me");
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] users/me failed:", status, excerpt);
      return { userId: null, timezone: null };
    }

    const id = pickString(json?.data?.id ?? json?.id);
    const attrs = json?.data?.attributes ?? json;
    const timezone = pickString(attrs?.time_zone ?? attrs?.timezone ?? attrs?.timeZone);

    return { userId: id, timezone };
  } catch (err) {
    console.error("[Lawmatics] users/me exception:", err);
    return { userId: null, timezone: null };
  }
}

async function lawmaticsResolveHostUserId(
  accessToken: string,
  hostEmail: string | null
): Promise<{ userId: string | null; matchedBy: "email" | "first" | "none" }> {
  try {
    const res = await lawmaticsFetch(accessToken, "GET", "/v1/users?per_page=100");
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] list users failed:", status, excerpt);
      return { userId: null, matchedBy: "none" };
    }

    const users: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.users) ? json.users : [];

    const normalizedHost = (hostEmail || "").trim().toLowerCase();

    if (normalizedHost) {
      const byEmail = users.find((u) => {
        const attrs = u?.attributes ?? u;
        const email = pickString(attrs?.email);
        return email?.toLowerCase() === normalizedHost;
      });
      const id = pickString(byEmail?.id ?? byEmail?.data?.id);
      if (id) return { userId: id, matchedBy: "email" };
    }

    const firstId = pickString(users?.[0]?.id ?? users?.[0]?.data?.id);
    if (firstId) return { userId: firstId, matchedBy: "first" };

    return { userId: null, matchedBy: "none" };
  } catch (err) {
    console.error("[Lawmatics] resolve host user exception:", err);
    return { userId: null, matchedBy: "none" };
  }
}

async function lawmaticsFindOrCreateContact(
  accessToken: string,
  attendee: Attendee
): Promise<string | null> {
  const email = pickString(attendee?.email);
  if (!email) return null;

  // 1) Search
  try {
    const res = await lawmaticsFetch(
      accessToken,
      "GET",
      `/v1/contacts?search=${encodeURIComponent(email)}&per_page=1`
    );
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (ok) {
      const contacts: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.contacts) ? json.contacts : [];
      const first = contacts?.[0];
      const id = pickString(first?.id ?? first?.data?.id);
      if (id) return id;
    } else {
      console.log("[Lawmatics] contact search failed:", status, excerpt);
    }
  } catch (err) {
    console.log("[Lawmatics] contact search exception:", err);
  }

  // 2) Create
  const name = pickString(attendee?.name) || "Test Booking";
  const tokens = name.split(/\s+/).filter(Boolean);
  const first_name = pickString(attendee?.first_name) || tokens[0] || "Test";
  const last_name = pickString(attendee?.last_name) || tokens.slice(1).join(" ") || "Booking";

  try {
    const payload = { first_name, last_name, email };
    const res = await lawmaticsFetch(accessToken, "POST", "/v1/contacts", payload);
    const { ok, status, json, excerpt } = await lawmaticsJson(res);

    if (!ok) {
      console.error("[Lawmatics] create contact failed:", status, excerpt);
      return null;
    }

    return pickString(json?.data?.id ?? json?.id);
  } catch (err) {
    console.error("[Lawmatics] create contact exception:", err);
    return null;
  }
}

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
      // Keep raw fragments for debugging (no tokens)
      _relationships: rel,
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

async function lawmaticsDeleteEvent(accessToken: string, eventId: string): Promise<boolean> {
  try {
    const res = await lawmaticsFetch(accessToken, "DELETE", `/v1/events/${encodeURIComponent(eventId)}`);
    return res.ok;
  } catch {
    return false;
  }
}

// Helper to refresh Google token
async function refreshAccessToken(
  connectionId: string,
  refreshToken: string,
  supabase: any
): Promise<string | null> {
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }

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

    if (!tokenResponse.ok) {
      return null;
    }

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

// Helper to create Lawmatics event with robust validation + repair.
// Returns a structured object for the UI to reason about "Created" vs "Created (incomplete)".
async function createLawmaticsEvent(
  accessToken: string,
  eventName: string,
  description: string,
  startDatetime: string,
  endDatetime: string,
  timezone: string,
  eventTypeId: string | null | undefined,
  locationId: string | null | undefined,
  lawmaticsUserId: string | null,
  lawmaticsContactId: string | null,
  supabase: any,
  meetingId: string,
  runId: string,
  opts: { requiresLocation: boolean }
): Promise<{
  ok: boolean;
  createdId: string | null;
  attempts: Array<{ step: string; status: number; ok: boolean; note?: string }>;
  readback: any | null;
  missingFields: string[];
  error?: IntegrationError;
}> {
  const attempts: Array<{ step: string; status: number; ok: boolean; note?: string }> = [];

  const startParts = toLocalDateTimeParts(startDatetime, timezone);
  const endParts = toLocalDateTimeParts(endDatetime, timezone);

  const canonical: Record<string, any> = {
    name: eventName,
    description,
    start_date: startParts.date, // YYYY-MM-DD
    start_time: startParts.time, // HH:mm
    end_date: endParts.date,
    end_time: endParts.time,
  };

  if (eventTypeId) canonical.event_type_id = String(eventTypeId);
  if (locationId) canonical.location_id = String(locationId);

  // IMPORTANT: Lawmatics sometimes assigns users via relationships.users (array).
  // We send both user_id and user_ids to maximize compatibility.
  if (lawmaticsUserId) {
    canonical.user_id = String(lawmaticsUserId);
    canonical.user_ids = [String(lawmaticsUserId)];
  }

  if (lawmaticsContactId) {
    canonical.contact_id = String(lawmaticsContactId);
    // Some installs represent contact as eventable; this is a safe hint and doesn't include secrets.
    canonical.eventable_type = "Contact";
    canonical.eventable_id = String(lawmaticsContactId);
  }

  const expected = {
    requiresLocation: opts.requiresLocation,
    expectContact: !!lawmaticsContactId,
  };

  const computeMissingFields = (rb: any | null): string[] => {
    const missing: string[] = [];
    if (!rb) return ["readback"];

    if (!rb.user_id) missing.push("user_id");

    if (!(rb.start_time || rb.starts_at)) missing.push("start_time");
    if (!(rb.end_time || rb.ends_at)) missing.push("end_time");

    if (!rb.start_date) missing.push("start_date");
    if (!rb.end_date) missing.push("end_date");

    if (!rb.event_type_id) missing.push("event_type_id");

    if (expected.expectContact && !rb.contact_id) missing.push("contact_id");

    if (expected.requiresLocation) {
      if (!rb.location_id) missing.push("location_id");
    }

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

  const validate = async (eventId: string, step: string): Promise<{ readback: any | null; missingFields: string[] }> => {
    const rb = await lawmaticsReadEvent(accessToken, eventId);
    const missingFields = computeMissingFields(rb);

    await writeLog(supabase, meetingId, runId, "lawmatics_readback", "info", step, {
      event_id: eventId,
      missingFields,
      readback: rb,
    });

    return { readback: rb, missingFields };
  };

  const repair = async (
    eventId: string,
    step: string
  ): Promise<{ readback: any | null; missingFields: string[]; repaired: boolean }> => {
    // Try PATCH then PUT with the canonical payload at root.
    const patch = await lawmaticsUpdateEvent(accessToken, eventId, "PATCH", canonical);
    attempts.push({ step: "lawmatics_patch_fix", status: patch.status, ok: patch.ok, note: patch.excerpt || undefined });
    await writeLog(supabase, meetingId, runId, "lawmatics_patch_fix", patch.ok ? "success" : "warn", step, {
      status: patch.status,
      excerpt: patch.excerpt,
    });

    let v1 = await validate(eventId, "Readback after PATCH");
    if (v1.missingFields.length === 0) return { readback: v1.readback, missingFields: v1.missingFields, repaired: true };

    const put = await lawmaticsUpdateEvent(accessToken, eventId, "PUT", canonical);
    attempts.push({ step: "lawmatics_put_fix", status: put.status, ok: put.ok, note: put.excerpt || undefined });
    await writeLog(supabase, meetingId, runId, "lawmatics_put_fix", put.ok ? "success" : "warn", step, {
      status: put.status,
      excerpt: put.excerpt,
    });

    const v2 = await validate(eventId, "Readback after PUT");
    return { readback: v2.readback, missingFields: v2.missingFields, repaired: put.ok && v2.missingFields.length === 0 };
  };

  try {
    await writeLog(supabase, meetingId, runId, "lawmatics_create_attempt_1_date_time", "info", "Creating Lawmatics appointment (attempt 1: canonical root)", {
      timezone_used: timezone,
      start: startParts,
      end: endParts,
      fields: Object.keys(canonical),
    });

    // Attempt 1: canonical at root
    const a1 = await postEvent("lawmatics_create_attempt_1_date_time", canonical);
    if (!a1.ok || !a1.createdId) {
      await writeLog(supabase, meetingId, runId, "lawmatics_error", "error", "Lawmatics create failed (attempt 1)", {
        status: a1.status,
        excerpt: a1.excerpt,
      });
    } else {
      let v = await validate(a1.createdId, "Readback after create attempt 1");
      if (v.missingFields.length === 0) {
        await writeLog(supabase, meetingId, runId, "lawmatics_final_success", "success", "Lawmatics event created and validated", {
          event_id: a1.createdId,
        });
        return { ok: true, createdId: a1.createdId, attempts, readback: v.readback, missingFields: [] };
      }

      // Repair attempt
      const r = await repair(a1.createdId, "Repairing incomplete create (attempt 1)");
      if (r.missingFields.length === 0) {
        await writeLog(supabase, meetingId, runId, "lawmatics_final_success", "success", "Lawmatics event repaired and validated", {
          event_id: a1.createdId,
        });
        return { ok: true, createdId: a1.createdId, attempts, readback: r.readback, missingFields: [] };
      }

      // Delete & recreate with alternate envelopes
      await writeLog(supabase, meetingId, runId, "lawmatics_recreate", "warn", "Recreating Lawmatics event (attempt 1 was incomplete)", {
        event_id: a1.createdId,
        missingFields: r.missingFields,
      });
      const deleted = await lawmaticsDeleteEvent(accessToken, a1.createdId);
      attempts.push({ step: "lawmatics_delete", status: deleted ? 204 : 0, ok: deleted, note: deleted ? "deleted" : "delete_failed" });

      // Attempt 1b: { event: canonical }
      await writeLog(supabase, meetingId, runId, "lawmatics_create_attempt_alt", "info", "Creating Lawmatics appointment (attempt 2: {event: payload})");
      const a2 = await postEvent("lawmatics_create_attempt_2_event_envelope", { event: canonical });
      if (a2.ok && a2.createdId) {
        let v2 = await validate(a2.createdId, "Readback after create attempt 2");
        if (v2.missingFields.length === 0) {
          await writeLog(supabase, meetingId, runId, "lawmatics_final_success", "success", "Lawmatics event created and validated (event envelope)", {
            event_id: a2.createdId,
          });
          return { ok: true, createdId: a2.createdId, attempts, readback: v2.readback, missingFields: [] };
        }

        const r2 = await repair(a2.createdId, "Repairing incomplete create (event envelope)");
        if (r2.missingFields.length === 0) {
          await writeLog(supabase, meetingId, runId, "lawmatics_final_success", "success", "Lawmatics event repaired and validated (event envelope)", {
            event_id: a2.createdId,
          });
          return { ok: true, createdId: a2.createdId, attempts, readback: r2.readback, missingFields: [] };
        }
      }

      // Attempt 1c: { data: canonical }
      await writeLog(supabase, meetingId, runId, "lawmatics_create_attempt_alt", "info", "Creating Lawmatics appointment (attempt 3: {data: payload})");
      const a3 = await postEvent("lawmatics_create_attempt_3_data_envelope", { data: canonical });
      if (a3.ok && a3.createdId) {
        let v3 = await validate(a3.createdId, "Readback after create attempt 3");
        if (v3.missingFields.length === 0) {
          await writeLog(supabase, meetingId, runId, "lawmatics_final_success", "success", "Lawmatics event created and validated (data envelope)", {
            event_id: a3.createdId,
          });
          return { ok: true, createdId: a3.createdId, attempts, readback: v3.readback, missingFields: [] };
        }

        const r3 = await repair(a3.createdId, "Repairing incomplete create (data envelope)");
        if (r3.missingFields.length === 0) {
          await writeLog(supabase, meetingId, runId, "lawmatics_final_success", "success", "Lawmatics event repaired and validated (data envelope)", {
            event_id: a3.createdId,
          });
          return { ok: true, createdId: a3.createdId, attempts, readback: r3.readback, missingFields: [] };
        }

        // Final: return incomplete with best-known readback
        await writeLog(supabase, meetingId, runId, "lawmatics_error", "warn", "Lawmatics created but is still incomplete after repair/recreate", {
          event_id: a3.createdId,
          missingFields: r3.missingFields,
        });
        return { ok: false, createdId: a3.createdId, attempts, readback: r3.readback, missingFields: r3.missingFields };
      }

      // Could not recreate at all; return incomplete with original readback
      return { ok: false, createdId: a1.createdId, attempts, readback: r.readback, missingFields: r.missingFields };
    }

    // If we got here, attempt 1 didn't create.
    return {
      ok: false,
      createdId: null,
      attempts,
      readback: null,
      missingFields: ["create_failed"],
      error: {
        system: "lawmatics",
        status: attempts.at(-1)?.status,
        message: "Lawmatics create failed",
        responseExcerpt: attempts.at(-1)?.note,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeLog(supabase, meetingId, runId, "lawmatics_error", "error", "Lawmatics exception", { error: msg });

    return {
      ok: false,
      createdId: null,
      attempts,
      readback: null,
      missingFields: ["exception"],
      error: { system: "lawmatics", message: msg },
    };
  }
}

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
    let hostAttorney = null;
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

    // Update booking request
    if (meeting.booking_request_id) {
      await supabase
        .from("booking_requests")
        .update({ status: "Completed" })
        .eq("id", meeting.booking_request_id);
    }

    // Create Lawmatics appointment
    let lawmaticsAppointmentId: string | null = null;
    let lawmaticsReadback: Record<string, any> | null = null;

    await writeLog(supabase, meetingId, runId, "lawmatics_start", "info", "Checking Lawmatics connection...");

    const { data: lawmaticsConnection } = await supabase
      .from("lawmatics_connections")
      .select("access_token")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lawmaticsConnection?.access_token) {
      const lawmaticsAccessToken = lawmaticsConnection.access_token;
      const client = meeting.external_attendees?.[0] as { name?: string; email?: string } | undefined;
      
      // Step 1: Get Lawmatics user_id AND timezone
      await writeLog(supabase, meetingId, runId, "lawmatics_me_start", "info", "Fetching Lawmatics user (users/me)...");
      const meResult = await lawmaticsGetMe(lawmaticsAccessToken);
      const lawmaticsUserId = meResult.userId;
      const lawmaticsUserTimezone = meResult.timezone;
      
      if (lawmaticsUserId) {
        await writeLog(supabase, meetingId, runId, "lawmatics_me_fetched", "success", "Lawmatics user fetched", {
          lawmatics_user_id: lawmaticsUserId,
          lawmatics_user_email: meResult.email,
          lawmatics_user_timezone: lawmaticsUserTimezone,
        });
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_me_failed", "warn", "Could not fetch Lawmatics user - appointment may not be assigned");
      }
      
      // Determine which timezone to use for Lawmatics date/time conversion
      // Priority: Lawmatics user timezone > meeting timezone > default
      const effectiveTimezone = lawmaticsUserTimezone || meetingTimezone || "America/New_York";
      await writeLog(supabase, meetingId, runId, "lawmatics_timezone", "info", "Using timezone for Lawmatics", {
        effective: effectiveTimezone,
        lawmatics_user_tz: lawmaticsUserTimezone,
        meeting_tz: meetingTimezone,
      });
      
      // Step 2: Find or create contact for the attendee
      const attendeeEmail = client?.email || hostAttorney?.email || "";
      const attendeeName = client?.name || hostAttorney?.name || "";
      let lawmaticsContactId: string | null = null;
      
      if (attendeeEmail) {
        await writeLog(supabase, meetingId, runId, "lawmatics_contact_start", "info", "Finding/creating Lawmatics contact...", {
          attendee_email: attendeeEmail,
          attendee_name: attendeeName,
        });
        
        lawmaticsContactId = await lawmaticsFindOrCreateContact(lawmaticsAccessToken, attendeeEmail, attendeeName);
        
        if (lawmaticsContactId) {
          await writeLog(supabase, meetingId, runId, "lawmatics_contact_resolved", "success", "Lawmatics contact resolved", {
            contact_id: lawmaticsContactId,
            attendee_email: attendeeEmail,
          });
        } else {
          await writeLog(supabase, meetingId, runId, "lawmatics_contact_failed", "warn", "Could not find/create Lawmatics contact - appointment may not be linked to contact");
        }
      } else {
        await writeLog(supabase, meetingId, runId, "lawmatics_contact_skip", "warn", "No attendee email - skipping contact lookup");
      }
      
      // Log if mapping IDs are missing
      if (!meeting.meeting_types?.lawmatics_event_type_id) {
        await writeLog(supabase, meetingId, runId, "lawmatics_mapping_warn", "warn", "No lawmatics_event_type_id mapped for this meeting type");
      }
      if (meeting.location_mode === "InPerson" && !meeting.rooms?.lawmatics_location_id) {
        await writeLog(supabase, meetingId, runId, "lawmatics_mapping_warn", "warn", "No lawmatics_location_id mapped for this room");
      }
      
      // Step 3: Create the event with user_id and contact_id
      const eventName = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Client"} - ${hostAttorney?.name || "Attorney"}`;

      const descriptionParts = [
        "⚠️ TEST BOOKING - Created from Admin Test My Booking",
        "",
        `Meeting Type: ${meeting.meeting_types?.name || "Meeting"}`,
        `Duration: ${meeting.duration_minutes} minutes`,
        `Location: ${meeting.location_mode === "InPerson" ? (meeting.rooms?.name || "In Person") : "Zoom"}`,
        hostAttorney ? `Host Attorney: ${hostAttorney.name} (${hostAttorney.email})` : null,
      ].filter(Boolean).join("\n");

      const lawmaticsResult = await createLawmaticsEvent(
        lawmaticsAccessToken,
        eventName,
        descriptionParts,
        startDatetime,
        endDatetime,
        effectiveTimezone,
        meeting.meeting_types?.lawmatics_event_type_id,
        meeting.location_mode === "InPerson" ? meeting.rooms?.lawmatics_location_id : null,
        lawmaticsUserId,
        lawmaticsContactId,
        supabase,
        meetingId,
        runId
      );

      if (lawmaticsResult.success) {
        lawmaticsAppointmentId = lawmaticsResult.appointmentId || null;
        lawmaticsReadback = lawmaticsResult.readback || null;
      } else if (lawmaticsResult.error) {
        errors.push(lawmaticsResult.error);
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

    // Create Google Calendar event
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

        const client = meeting.external_attendees?.[0];
        const eventSummary = `[TEST] ${meeting.meeting_types?.name || "Meeting"} - ${client?.name || "Test"} - ${hostAttorney?.name || "Attorney"}`;

        const attendees: { email: string; resource?: boolean }[] = [];
        if (hostAttorney?.email) attendees.push({ email: hostAttorney.email });
        if (client?.email) attendees.push({ email: client.email });
        if (meeting.rooms?.resource_email) attendees.push({ email: meeting.rooms.resource_email, resource: true });

        const eventBody = {
          summary: eventSummary,
          description: `⚠️ TEST BOOKING - Created from Admin Test My Booking\n\nMeeting Type: ${meeting.meeting_types?.name || "Meeting"}\nRoom: ${meeting.rooms?.name || "N/A"}`,
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
            calendarId: adminCalendarId,
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
        errors.push({
          system: "google",
          message: `Google Calendar request failed: ${errorMessage}`,
        });
        await writeLog(supabase, meetingId, runId, "google_error", "error", "Google Calendar request failed", { error: errorMessage });
      }
    } else {
      await writeLog(supabase, meetingId, runId, "google_skip", "warn", "No Google calendar connection or calendar ID");
    }

    // Update meeting with Google event ID
    if (googleEventId) {
      await supabase
        .from("meetings")
        .update({
          preferences: {
            ...preferences,
            google_event_id: googleEventId,
          },
        })
        .eq("id", meetingId);
    }

    // Determine if Lawmatics result is actually valid
    const lawmaticsIsValid = lawmaticsReadback && 
      (lawmaticsReadback.start_time || lawmaticsReadback.starts_at) && 
      lawmaticsReadback.user_id;
    
    // Log completion
    const hasErrors = errors.length > 0 || (lawmaticsAppointmentId && !lawmaticsIsValid);
    await writeLog(
      supabase,
      meetingId,
      runId,
      "done",
      hasErrors ? "warn" : "success",
      hasErrors ? "Test booking completed with some warnings" : "Test booking completed successfully",
      {
        lawmaticsAppointmentId,
        lawmaticsIsValid,
        googleEventId,
        errors,
      }
    );

    // Create audit log
    await supabase.from("audit_logs").insert({
      action_type: "Booked",
      meeting_id: meetingId,
      details_json: {
        is_test: true,
        booked_at: new Date().toISOString(),
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        lawmatics_appointment_id: lawmaticsAppointmentId,
        google_event_id: googleEventId,
        admin_calendar_id: adminCalendarId,
        errors: hasErrors ? errors : undefined,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        ok: true,
        meetingId,
        lawmaticsAppointmentId,
        lawmaticsReadback,
        lawmaticsIsValid,
        googleEventId,
        hasErrors,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in confirm-test-booking:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        ok: false,
        error: { message: error instanceof Error ? error.message : "Unknown error" } 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
