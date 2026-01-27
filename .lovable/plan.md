

# Fix Microsoft Outlook OAuth Integration

## Problem Summary
The Microsoft OAuth flow is failing with error `AADSTS7000215` because the `MICROSOFT_CLIENT_SECRET` contains the Secret ID (a UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) instead of the actual Secret Value (a random string like `abc123XYZ~...`).

## Solution

### Step 1: Update the MICROSOFT_CLIENT_SECRET
Replace the current secret with the correct client secret value you obtained from Azure Portal.

### Step 2: Test the OAuth Flow
1. Navigate to Admin Settings > Calendar section
2. Click "Connect Microsoft Outlook Calendar"
3. Complete the Microsoft consent flow
4. Verify calendars are listed after redirect

## Technical Details

The edge function `microsoft-oauth-callback` exchanges the authorization code for tokens using:
- `MICROSOFT_CLIENT_ID` - Your Azure app's Application (client) ID
- `MICROSOFT_CLIENT_SECRET` - The secret **value** (not the secret ID)

When the secret is incorrect, Microsoft returns `AADSTS7000215: Invalid client secret provided`.

## Expected Outcome
After updating the secret:
- OAuth token exchange will succeed
- Calendar connection will be saved to `calendar_connections` table
- User will be redirected with `microsoft_success=true`
- `microsoft-list-calendars` will fetch and display available calendars

