

# Embeddable Lawmatics Intake Forms

## Overview
Create two standalone, embeddable HTML pages designed to be placed as iframes in Lawmatics custom form instruction blocks. These forms will collect client intake data and submit it directly to Lawmatics via backend Edge Functions, with dynamic dropdown options fetched from the Lawmatics API.

## Form Structure (Based on Screenshots)

### Page 1: Contact Information (`/intake/contact`)
Fields from the screenshots:
| Field | Type | Required | Lawmatics API Field |
|-------|------|----------|---------------------|
| First Name | text | Yes | `first_name` |
| Middle Name | text | No | `middle_name` |
| Last Name | text | Yes | `last_name` |
| Phone (Primary) | tel | No | `phone` |
| Email (Primary) | email | Yes | `email` |
| Is this an Existing Client? | dropdown | Yes | Custom field / logic flag |
| Next Steps | dropdown | Yes | `stage` or custom field |
| Notes or Message | textarea | No | `notes` |

### Page 2: Intake Information (`/intake/details`)
Fields from the screenshots:
| Field | Type | Required | Lawmatics API Field |
|-------|------|----------|---------------------|
| Preferred Name | text | No | `preferred_name` or custom |
| Gender | dropdown | No | `gender` or custom |
| Address (Primary) - Street | text | No | `address_line_1` |
| Address (Primary) - Street2 | text | No | `address_line_2` |
| City | text | No | `city` |
| State | dropdown | No | `state` |
| Zipcode | text | No | `zip` |
| Practice Area | dropdown | Yes | `practice_area_id` (dynamic from Lawmatics) |
| How Did You Hear About Us? | dropdown | Yes | `source` or `referral_source` (dynamic from Lawmatics) |
| Is there a second client? | dropdown | Yes | Custom field |
| Additional People (Conflict Check) | textarea | No | `notes` or custom |
| Matter's Description | textarea | No | `case_title` / `notes` |
| Intake Notes | textarea | No | `notes` |
| Next Steps | dropdown | Yes | `stage` or custom |

## Architecture

```text
+-------------------+     +------------------------+     +------------------+
|  Intake Form      |     |  Edge Functions        |     |  Lawmatics API   |
|  (iframe pages)   | --> |  lawmatics-intake-*    | --> |  /v1/contacts    |
|                   |     |                        |     |  /v1/prospects   |
+-------------------+     +------------------------+     +------------------+
                               |
                               v
                    +----------------------+
                    | lawmatics_connections|
                    | (access_token)       |
                    +----------------------+
```

## Implementation Plan

### Step 1: Create Edge Functions for Reference Data

Create new edge functions to fetch dynamic dropdown options from Lawmatics:

**1.1. `lawmatics-list-practice-areas`**
- Endpoint: `GET /v1/practice_areas` (or similar)
- Returns: `{ items: [{ id, name }] }`
- Cache in `lawmatics_reference_data` table

**1.2. `lawmatics-list-sources`**
- Endpoint: `GET /v1/sources` or `/v1/referral_sources`
- Returns: `{ items: [{ id, name }] }`
- Cache in `lawmatics_reference_data` table

**1.3. `lawmatics-list-stages`** (for Next Steps dropdown)
- Endpoint: `GET /v1/stages` or `/v1/pipelines`
- Returns: `{ items: [{ id, name }] }`

### Step 2: Create Intake Submission Edge Function

**2.1. `lawmatics-submit-intake`**
- Public endpoint (no auth required - for iframe use)
- Accepts combined data from both form pages
- Calls Lawmatics API to:
  1. Create or find Contact (`POST /v1/contacts`)
  2. Create Matter/Prospect (`POST /v1/prospects`)
  3. Attach all collected fields
- Returns success/failure response

### Step 3: Create Frontend Pages

**3.1. Page 1: Contact Information**
- Route: `/intake/contact`
- File: `src/pages/intake/IntakeContact.tsx`
- Minimal layout (no header/nav for iframe embedding)
- Form fields with validation
- Stores data in sessionStorage for Page 2 access
- Navigation to Page 2

**3.2. Page 2: Intake Details**
- Route: `/intake/details`
- File: `src/pages/intake/IntakeDetails.tsx`
- Fetches dynamic options via public edge functions
- Combines Page 1 data from sessionStorage
- Submits all data to `lawmatics-submit-intake`
- Shows success/error state

**3.3. Shared Components**
- `src/components/intake/IntakeFormLayout.tsx` - Clean iframe-friendly wrapper
- `src/components/intake/IntakeSelect.tsx` - Styled dropdown for consistency
- Uses existing UI components (Input, Select, Textarea, Button)

### Step 4: Add Routes

Update `src/App.tsx` to add public routes:
```typescript
<Route path="/intake/contact" element={<IntakeContact />} />
<Route path="/intake/details" element={<IntakeDetails />} />
```

## Field Mappings to Lawmatics API

Based on Lawmatics API documentation patterns observed in the codebase:

**Contact Fields (POST /v1/contacts)**:
- `first_name`, `middle_name`, `last_name`
- `email`, `phone`
- `address_line_1`, `address_line_2`, `city`, `state`, `zip`
- `preferred_name`, `gender`
- `source_id` or `referral_source`

**Matter/Prospect Fields (POST /v1/prospects)**:
- `first_name`, `last_name`, `email` (for matching)
- `case_title` (from Matter's Description)
- `practice_area_id`
- `notes` (combined intake notes)
- `stage_id` (Next Steps)

## Styling Considerations

- Clean, minimal design suitable for iframe embedding
- White background with proper contrast
- Responsive for various iframe sizes
- Match the styling shown in screenshots (blue navigation, red required field indicators)
- Use existing Tailwind/shadcn components

## Data Flow

```text
1. User opens Page 1 (Contact Information)
2. User fills out form, clicks "Next"
3. Data stored in sessionStorage
4. User navigates to Page 2 (Intake Details)
5. Dropdown options fetched from Edge Functions
6. User completes form, clicks "Submit"
7. Combined data sent to lawmatics-submit-intake
8. Edge function creates Contact + Matter in Lawmatics
9. Success/error message displayed to user
```

## Security Considerations

- Edge functions for reference data can be public (read-only cached data)
- Intake submission function validates all inputs
- No sensitive data exposed in frontend
- Lawmatics access token stays in backend only
- Rate limiting recommended for production

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/intake/IntakeContact.tsx` | Page 1 - Contact form |
| `src/pages/intake/IntakeDetails.tsx` | Page 2 - Intake details form |
| `src/components/intake/IntakeFormLayout.tsx` | Shared layout wrapper |
| `supabase/functions/lawmatics-list-practice-areas/index.ts` | Fetch practice areas |
| `supabase/functions/lawmatics-list-sources/index.ts` | Fetch referral sources |
| `supabase/functions/lawmatics-list-stages/index.ts` | Fetch stages/next steps |
| `supabase/functions/lawmatics-submit-intake/index.ts` | Submit intake to Lawmatics |

## Files to Modify

| File | Changes |
|------|---------|
| `src/App.tsx` | Add intake routes |
| `supabase/config.toml` | Add new edge function configs |
| `openapi.yaml` | Document new endpoints |

