

# ✅ COMPLETED: Add Calendar Provider Selection to Create Booking Request

## Overview
When a user has both Google Calendar and Microsoft Outlook connected, they can now choose which calendar provider to use for availability checking and event creation when creating a booking request.

## Implementation Status: COMPLETE

### What was implemented:
1. **Database Migration**: Added `calendar_provider` column to `meetings` table and created `meeting_microsoft_events` table for tracking Microsoft events
2. **Frontend (RequestNew.tsx)**: Added calendar provider selection dropdown, dual-provider badges for participants, and dynamic warnings
3. **Backend (confirm-booking)**: Added Microsoft Calendar event creation with token refresh, branching logic based on provider selection

## Implementation Plan

### Step 1: Database Schema Update
Add a `calendar_provider` column to the `meetings` table to store the user's choice:
- Type: `calendar_provider` enum (`google` | `microsoft`)
- Nullable: Yes (defaults to null, meaning auto-detect or use available provider)

### Step 2: Frontend Changes (RequestNew.tsx)

**2.1 Update CompanyMember Interface**
```typescript
interface CompanyMember {
  id: string;
  name: string;
  email: string;
  role: string;
  hasGoogleConnection: boolean;
  hasMicrosoftConnection: boolean;  // NEW
}
```

**2.2 Update FormData Interface**
```typescript
interface FormData {
  // ... existing fields
  calendarProvider: "google" | "microsoft" | "";  // NEW
}
```

**2.3 Update Company Members Query**
Fetch both Google and Microsoft connections:
```typescript
const { data: googleConnections } = await supabase
  .from("calendar_connections")
  .select("user_id")
  .eq("provider", "google");

const { data: microsoftConnections } = await supabase
  .from("calendar_connections")
  .select("user_id")
  .eq("provider", "microsoft");

// Populate hasGoogleConnection and hasMicrosoftConnection
```

**2.4 Add Calendar Provider Selection UI**
On the Participants step (Step 2), add a calendar provider dropdown:
- Only show if at least one participant has both Google and Microsoft connections
- Options: "Google Calendar" or "Microsoft Outlook"
- Default to the provider that all selected participants have connected

**2.5 Update Calendar Status Badges**
Show which calendars each participant has connected:
- Green badge for connected providers
- Warning badge if selected provider isn't connected for a participant

**2.6 Update Warning Messages**
Change "Google Calendar" references to be dynamic based on selected provider

### Step 3: Backend Changes (confirm-booking/index.ts)

**3.1 Add Microsoft Token Refresh Helper**
Create `refreshMicrosoftTokenIfNeeded` function similar to Google's implementation

**3.2 Add Microsoft Event Creation Function**
Create `createMicrosoftCalendarEventForUser` function:
- Use Microsoft Graph API: `POST /me/calendars/{calendarId}/events`
- Handle token refresh with retry on 401
- Store event ID in meeting record (`m365_event_id`)

**3.3 Add Batch Microsoft Event Creation**
Create `createMicrosoftCalendarEventsForAllParticipants` function:
- Similar pattern to Google's batch creation
- Create a `meeting_microsoft_events` table (optional) or use `m365_event_id` in meetings table

**3.4 Update Main Handler Logic**
Branch between Google and Microsoft event creation based on meeting's `calendar_provider` preference:
```typescript
const calendarProvider = meeting.calendar_provider || "google";
if (calendarProvider === "microsoft") {
  // Create Microsoft events
} else {
  // Create Google events (existing logic)
}
```

### Step 4: Update Meeting Insert
Store the selected calendar provider in the meetings table:
```typescript
.insert({
  // ... existing fields
  calendar_provider: formData.calendarProvider || null,
})
```

## File Changes Summary

| File | Changes |
|------|---------|
| Database Migration | Add `calendar_provider` column to `meetings` table |
| `src/pages/RequestNew.tsx` | Update interface, query, and add provider selection UI |
| `supabase/functions/confirm-booking/index.ts` | Add Microsoft event creation logic and provider branching |

## UI/UX Design

### Calendar Provider Selection (Participants Step)
```
┌─────────────────────────────────────────────────┐
│ Calendar Provider                               │
│ Select which calendar to use for this booking   │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ 📅 Google Calendar                     ▼    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Options:                                        │
│ • Google Calendar                               │
│ • Microsoft Outlook                             │
└─────────────────────────────────────────────────┘
```

### Updated Participant Badge Display
```
┌─────────────────────────────────────────────────┐
│ John Doe (john@example.com)                     │
│   ✓ Google   ✓ Microsoft                        │
├─────────────────────────────────────────────────┤
│ Jane Smith (jane@example.com)                   │
│   ✓ Google   ✗ Microsoft                        │
└─────────────────────────────────────────────────┘
```

## Technical Considerations

1. **Backward Compatibility**: If `calendar_provider` is null, default to Google (existing behavior)
2. **Mixed Providers**: If some participants only have Google and user selects Microsoft, show a warning that those participants' calendars won't be updated
3. **Availability Checks**: The backend already supports both providers for availability - no changes needed there
4. **Event Tracking**: Consider creating a `meeting_microsoft_events` table similar to `meeting_google_events` for tracking Microsoft event IDs per participant

