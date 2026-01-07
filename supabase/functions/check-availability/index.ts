import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BusyInterval {
  start: string;
  end: string;
}

interface AvailabilityRequest {
  participantUserIds: string[];
  roomResourceEmail?: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  preferences?: {
    businessHoursStart?: string; // "09:00"
    businessHoursEnd?: string; // "17:00"
    lunchStart?: string; // "12:00"
    lunchEnd?: string; // "13:00"
    minimumNoticeMinutes?: number;
    timezone?: string;
  };
}

interface TimeSlot {
  start: string;
  end: string;
}

// Calendar Provider Interface
interface CalendarProvider {
  getBusyIntervals(accessToken: string, calendars: string[], start: string, end: string): Promise<BusyInterval[]>;
}

// Google Calendar Provider
const googleProvider: CalendarProvider = {
  async getBusyIntervals(accessToken: string, calendars: string[], start: string, end: string): Promise<BusyInterval[]> {
    const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: start,
        timeMax: end,
        items: calendars.map(id => ({ id })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google FreeBusy API error:", errorText);
      throw new Error(`Google Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    const allBusy: BusyInterval[] = [];

    for (const calendarId of Object.keys(data.calendars || {})) {
      const calendar = data.calendars[calendarId];
      if (calendar.busy) {
        allBusy.push(...calendar.busy);
      }
    }

    return allBusy;
  }
};

// Suggest available slots based on busy intervals
function suggestSlots(
  busyIntervals: BusyInterval[],
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  preferences: AvailabilityRequest["preferences"] = {}
): TimeSlot[] {
  const {
    businessHoursStart = "09:00",
    businessHoursEnd = "17:00",
    lunchStart,
    lunchEnd,
    minimumNoticeMinutes = 60,
    timezone = "America/New_York",
  } = preferences;

  const slots: TimeSlot[] = [];
  const now = new Date();
  const minimumNoticeTime = new Date(now.getTime() + minimumNoticeMinutes * 60 * 1000);

  // Sort busy intervals by start time
  const sortedBusy = busyIntervals
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Iterate through each day
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (currentDate <= endDate) {
    // Skip weekends
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // Parse business hours for this day
    const [startHour, startMin] = businessHoursStart.split(":").map(Number);
    const [endHour, endMin] = businessHoursEnd.split(":").map(Number);

    const dayStart = new Date(currentDate);
    dayStart.setHours(startHour, startMin, 0, 0);

    const dayEnd = new Date(currentDate);
    dayEnd.setHours(endHour, endMin, 0, 0);

    // Parse lunch block if specified
    let lunchStartTime: Date | null = null;
    let lunchEndTime: Date | null = null;
    if (lunchStart && lunchEnd) {
      const [lunchStartHour, lunchStartMin] = lunchStart.split(":").map(Number);
      const [lunchEndHour, lunchEndMin] = lunchEnd.split(":").map(Number);
      lunchStartTime = new Date(currentDate);
      lunchStartTime.setHours(lunchStartHour, lunchStartMin, 0, 0);
      lunchEndTime = new Date(currentDate);
      lunchEndTime.setHours(lunchEndHour, lunchEndMin, 0, 0);
    }

    // Get busy intervals for this day
    const dayBusy = sortedBusy.filter(b => 
      b.start < dayEnd && b.end > dayStart
    );

    // Add lunch as a busy interval if specified
    if (lunchStartTime && lunchEndTime) {
      dayBusy.push({ start: lunchStartTime, end: lunchEndTime });
      dayBusy.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    // Find free slots
    let slotStart = dayStart;

    for (const busy of dayBusy) {
      // If there's a gap before this busy period
      if (busy.start > slotStart) {
        const gapEnd = busy.start;
        
        // Check if gap is long enough for a meeting
        const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (1000 * 60);
        
        if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
          // Generate slots within this gap
          let currentSlotStart = new Date(slotStart);
          while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= gapEnd.getTime()) {
            if (currentSlotStart >= minimumNoticeTime) {
              const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
              slots.push({
                start: currentSlotStart.toISOString(),
                end: slotEnd.toISOString(),
              });
            }
            // Move to next potential slot (30 min increments)
            currentSlotStart = new Date(currentSlotStart.getTime() + 30 * 60 * 1000);
          }
        }
      }
      
      // Move slot start to end of busy period
      if (busy.end > slotStart) {
        slotStart = busy.end;
      }
    }

    // Check for remaining time at end of day
    if (slotStart < dayEnd) {
      const gapDuration = (dayEnd.getTime() - slotStart.getTime()) / (1000 * 60);
      
      if (gapDuration >= durationMinutes && slotStart >= minimumNoticeTime) {
        let currentSlotStart = new Date(slotStart);
        while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          if (currentSlotStart >= minimumNoticeTime) {
            const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
            slots.push({
              start: currentSlotStart.toISOString(),
              end: slotEnd.toISOString(),
            });
          }
          currentSlotStart = new Date(currentSlotStart.getTime() + 30 * 60 * 1000);
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Limit to reasonable number of slots
  return slots.slice(0, 20);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const body: AvailabilityRequest = await req.json();
    const { participantUserIds, roomResourceEmail, startDate, endDate, durationMinutes, preferences } = body;

    console.log("Checking availability for:", { participantUserIds, roomResourceEmail, startDate, endDate });

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get calendar connections for all participants
    const { data: connections, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("provider", "google")
      .in("user_id", participantUserIds);

    if (connError) {
      console.error("Failed to fetch connections:", connError);
      throw connError;
    }

    const allBusyIntervals: BusyInterval[] = [];

    // Check each participant's calendar
    for (const connection of connections || []) {
      // Check if token is expired
      if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
        console.log(`Token expired for user ${connection.user_id}, skipping`);
        continue;
      }

      try {
        // Get user's email for calendar lookup
        const { data: userData } = await supabase
          .from("users")
          .select("email")
          .eq("id", connection.user_id)
          .single();

        if (!userData?.email) continue;

        const calendars = [userData.email];
        const busy = await googleProvider.getBusyIntervals(
          connection.access_token,
          calendars,
          startDate,
          endDate
        );
        allBusyIntervals.push(...busy);
      } catch (err) {
        console.error(`Failed to get busy for user ${connection.user_id}:`, err);
      }
    }

    // Check room availability if in-person meeting
    if (roomResourceEmail) {
      // Find a connection with calendar access to check the room
      // Typically this would be a service account or admin connection
      const adminConnection = connections?.[0];
      if (adminConnection) {
        try {
          const busy = await googleProvider.getBusyIntervals(
            adminConnection.access_token,
            [roomResourceEmail],
            startDate,
            endDate
          );
          allBusyIntervals.push(...busy);
        } catch (err) {
          console.error("Failed to check room availability:", err);
        }
      }
    }

    // Generate available slots
    const slots = suggestSlots(
      allBusyIntervals,
      new Date(startDate),
      new Date(endDate),
      durationMinutes,
      preferences
    );

    console.log(`Found ${slots.length} available slots`);

    return new Response(JSON.stringify({ 
      slots,
      busyIntervals: allBusyIntervals,
      participantsChecked: connections?.length || 0
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in check-availability:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
