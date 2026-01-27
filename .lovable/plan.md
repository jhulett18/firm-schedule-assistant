

## Add Microsoft Outlook Integration Secrets

### Current State

**Existing secrets** (already configured):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `LAWMATICS_CLIENT_ID`
- `LAWMATICS_CLIENT_SECRET`

**Missing secrets** (need to be added):
- `MICROSOFT_CLIENT_ID` — Not configured
- `MICROSOFT_CLIENT_SECRET` — Not configured

**Not needed as secrets**:
- `MICROSOFT_TENANT` — The code already uses `common` endpoint, no secret needed
- `MICROSOFT_REDIRECT_URI` — Dynamically built from `SUPABASE_URL` (already available)

---

### Edge Functions Using Microsoft Secrets

The following 10 edge functions reference `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`:

| Function | Uses CLIENT_ID | Uses CLIENT_SECRET | Purpose |
|----------|----------------|-------------------|---------|
| `microsoft-oauth-start` | Yes | No | Initiates OAuth flow |
| `microsoft-oauth-callback` | Yes | Yes | Exchanges code for tokens |
| `microsoft-connection-status` | Yes | Yes | Verifies/refreshes tokens |
| `refresh-microsoft-token` | Yes | Yes | Background token refresh |
| `microsoft-list-calendars` | Yes | Yes | Lists user calendars |
| `microsoft-list-events` | Yes | Yes | Lists calendar events |
| `microsoft-availability-month` | Yes | Yes | Monthly availability check |
| `microsoft-availability-day` | Yes | Yes | Daily availability check |
| `check-availability` | Yes | Yes | General availability check |
| `public-available-slots` | Yes | Yes | Public booking slots |

---

### Secrets to Add

#### 1. MICROSOFT_CLIENT_ID
- **Description**: Azure AD application (App Registration) client ID
- **Where to get it**: Azure Portal → App Registrations → Your App → Application (client) ID
- **Used in**: All 10 Microsoft edge functions listed above

#### 2. MICROSOFT_CLIENT_SECRET
- **Description**: Azure AD application client secret value
- **Where to get it**: Azure Portal → App Registrations → Your App → Certificates & secrets → Client secrets
- **Used in**: 9 of 10 functions (all except `microsoft-oauth-start`)

---

### Secrets NOT Needed

#### MICROSOFT_TENANT
The code already uses `common` as the tenant, which supports both personal Microsoft accounts and organizational (Azure AD) accounts. This is hardcoded in the OAuth URLs:
```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize
https://login.microsoftonline.com/common/oauth2/v2.0/token
```

No secret is required. If a fixed tenant is needed later, the edge functions would need code changes.

#### MICROSOFT_REDIRECT_URI
The redirect URI is dynamically constructed from the existing `SUPABASE_URL` secret:
```typescript
const redirectUri = `${SUPABASE_URL}/functions/v1/microsoft-oauth-callback`;
```

The actual value is: `https://jgrcjwdvnigxvqvfouga.supabase.co/functions/v1/microsoft-oauth-callback`

This must be registered in Azure AD as a valid redirect URI.

---

### Azure Portal Configuration

When setting up the App Registration in Azure, configure:

1. **Redirect URI**: Add `https://jgrcjwdvnigxvqvfouga.supabase.co/functions/v1/microsoft-oauth-callback` as a Web redirect URI

2. **API Permissions**: Grant these Microsoft Graph permissions:
   - `Calendars.Read`
   - `Calendars.ReadWrite`
   - `User.Read`
   - `offline_access`

3. **Supported account types**: "Accounts in any organizational directory and personal Microsoft accounts" (for multi-tenant + personal accounts)

---

### Implementation Steps

1. Add `MICROSOFT_CLIENT_ID` secret with placeholder value
2. Add `MICROSOFT_CLIENT_SECRET` secret with placeholder value
3. User enters actual values from Azure Portal
4. Microsoft Outlook integration will work across all edge functions

---

### Technical Notes

- No code changes required — functions already use `Deno.env.get("MICROSOFT_CLIENT_ID")` etc.
- The `supabase/config.toml` may need entries for Microsoft functions if JWT verification should be disabled (similar to Google OAuth functions)
- Current Microsoft functions are NOT listed in `config.toml`, meaning they use default JWT verification

