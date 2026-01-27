
# Fix Microsoft Outlook Calendar Events Not Reflecting in Availability

## Problem Summary
Manually added events to Microsoft Outlook calendar are not affecting available time slots. The edge function logs show "Microsoft Events API found 0 events" even when events exist in the calendar.

## Root Cause Analysis
The Microsoft Graph API calendarView endpoint is returning empty results. This could be caused by:
1. Events being added to a different calendar than the one selected during OAuth
2. Events having their "Show As" status set to "Free" (which are intentionally skipped)
3. A mismatch between the calendar ID stored and the actual calendar being used

## Solution

### Step 1: Add Enhanced Logging to microsoft-availability-day
Add logging to capture the raw Microsoft API response before any filtering, including:
- The exact API endpoint being called
- The raw event count from Microsoft (before filtering)
- Sample event data (if any) to verify `showAs` status

### Step 2: Add Enhanced Logging to microsoft-availability-month  
Apply the same diagnostic logging to the month availability function.

### Step 3: Add Event Count to microsoft-list-events Response
Include total event count in the response to help debug calendar selection issues.

## Technical Details

### Code Changes in microsoft-availability-day/index.ts

In the `listEventsBusyIntervals` function (around line 138-218):
- Log the full API URL being requested
- Log the raw `data.value.length` before any filtering
- Log each event's `showAs` status to see if events are being filtered as "free"

```typescript
console.log(`Fetching events from: ${url}`);
console.log(`Raw events received from Microsoft: ${events.length}`);
for (const event of events) {
  console.log(`Event: ${event.subject || '(no title)'}, showAs: ${event.showAs}, isCancelled: ${event.isCancelled}`);
  // existing filtering logic...
}
```

### Code Changes in microsoft-availability-month/index.ts

In the `getBusyIntervals` function (around line 81-156):
- Add similar diagnostic logging
- Log each calendar being queried and the response

## Testing After Implementation
1. Add a test event to Outlook (ensure "Show As" is set to "Busy")
2. Navigate to Admin Settings > Calendar
3. Refresh the availability view
4. Check edge function logs for diagnostic output
5. Verify if the event appears in logs but is filtered, or if truly no events returned

## Expected Outcome
- Logs will reveal whether Microsoft returns events that get filtered, or returns zero events
- If zero events: suggests wrong calendar is selected - solution would be to re-connect Outlook or select the correct calendar
- If events present but filtered: suggests events are marked as "Free" - user should check event settings in Outlook
