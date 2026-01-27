# Firm Schedule Assistant - Project Context

> **Purpose:** Single source of truth for project context. Read this first to reduce exploration time and token usage.

## Quick Reference

| Property | Value |
|----------|-------|
| **Tech Stack** | Vite + React + TypeScript + Supabase |
| **Domain** | Legal practice meeting scheduling |
| **Multi-tenant** | Company-scoped with ownership model |
| **Auth** | Supabase Auth with custom user_roles table |
| **Styling** | Tailwind CSS + shadcn/ui |

---

## Roles & Access Summary

| Role | Security Role | Business Roles | Views | Auto-Approved |
|------|---------------|----------------|-------|---------------|
| Superuser | `superuser` | N/A | `/manager` | N/A |
| Owner | `admin` | Owner | `/dashboard`, `/admin/*` | Yes (registration code) |
| Admin | `admin` | Admin | `/dashboard`, `/admin/*` | No (needs approval) |
| Attorney | `staff` | Attorney | `/dashboard`, `/requests`, `/help`, `/settings` | No |
| Support Staff | `staff` | SupportStaff | `/dashboard`, `/requests`, `/help`, `/settings` | No |
| Client | `client` | N/A | `/client`, `/schedule`, `/r/:token` | N/A |

### Security Roles (user_roles table)
- `superuser` - Platform administrator (cross-company access)
- `admin` - Company administrator (Owner or Admin business role)
- `staff` - Company staff (Attorney or SupportStaff business role)
- `client` - External client (booking access only)

### Business Roles (users.role column)
- `Owner` - Company owner (one per company)
- `Admin` - Company administrator
- `Attorney` - Legal staff member
- `SupportStaff` - Support/administrative staff

---

## Route Structure

### Public Routes (no auth)
| Route | Page | Description |
|-------|------|-------------|
| `/` | Index.tsx | Landing/redirect |
| `/auth` | Auth.tsx | Login/signup |
| `/home` | Home.tsx | Marketing page |
| `/privacy` | Privacy.tsx | Privacy policy |
| `/terms` | Terms.tsx | Terms of service |
| `/access` | Access.tsx | Access code entry |
| `/client` | ClientHome.tsx | Client dashboard |
| `/schedule` | Schedule.tsx | Booking flow |
| `/r/:token` | TokenRedirect.tsx | Public booking link |
| `/pending-approval` | PendingApproval.tsx | Unapproved user landing |

### Staff Routes (StaffRoute guard)
| Route | Page | Description |
|-------|------|-------------|
| `/dashboard` | Dashboard.tsx | Main staff dashboard |
| `/requests` | Requests.tsx | Booking requests list |
| `/requests/new` | RequestNew.tsx | Create new request |
| `/help` | Help.tsx | Help documentation |
| `/settings` | StaffSettings.tsx | User settings |

### Admin Routes (AdminRoute guard)
| Route | Page | Description |
|-------|------|-------------|
| `/admin/users` | AdminUsers.tsx | User management |
| `/admin/rooms` | AdminRooms.tsx | Meeting rooms |
| `/admin/meeting-types` | AdminMeetingTypes.tsx | Meeting type config |
| `/admin/presets` | AdminPresets.tsx | Scheduling presets |
| `/admin/scheduler-mapping` | AdminSchedulerMapping.tsx | Scheduler mappings |
| `/admin/settings` | AdminSettings.tsx | Company settings |

### Superuser Routes (SuperuserRoute guard)
| Route | Page | Description |
|-------|------|-------------|
| `/manager` | ManagerDashboard.tsx | Cross-company management |

---

## Current Project State

### Completed
- Authentication system with role-based access
- Multi-tenant company model with ownership
- User approval workflow (staff require approval)
- Superuser dashboard for platform management
- Company registration/invite code system
- Google Calendar integration
- Lawmatics integration
- Booking request workflow

### In Progress
- Test account creation
- UI polish

---

## Edge Functions (31 total)

### Authentication & Account
- `delete-account` - User account deletion

### Google Calendar Integration
- `google-oauth-start` - Initiate OAuth flow
- `google-oauth-callback` - OAuth callback handler
- `google-connection-status` - Check connection status
- `google-disconnect` - Disconnect integration
- `google-list-calendars` - List user calendars
- `google-list-events` - List calendar events
- `google-availability-day` - Day availability check
- `google-availability-month` - Month availability check
- `google-busy-debug` - Debug busy times
- `refresh-google-token` - Token refresh

### Lawmatics Integration
- `lawmatics-oauth-start` - Initiate OAuth flow
- `lawmatics-oauth-callback` - OAuth callback handler
- `lawmatics-disconnect` - Disconnect integration
- `lawmatics-test` - Test connection
- `lawmatics-list-users` - List Lawmatics users
- `lawmatics-list-locations` - List locations
- `lawmatics-list-event-types` - List event types
- `lawmatics-find-matters-by-email` - Find matters

### Availability & Booking
- `check-availability` - Check slot availability
- `public-available-slots` - Public availability endpoint
- `public-booking-info` - Public booking information
- `confirm-booking` - Confirm a booking (public)
- `confirm-booking-staff` - Staff booking confirmation
- `manage-booking` - Manage existing booking

### Superuser
- `superuser-companies` - Company CRUD operations
- `superuser-users` - Cross-company user management

### Testing
- `create-test-booking-request` - Create test bookings
- `test-booking-available-slots` - Test availability
- `confirm-test-booking` - Confirm test bookings
- `health` - Health check endpoint

---

## Database Tables (Key)

### Core Tables
| Table | Purpose |
|-------|---------|
| `users` | User profiles (linked to auth.users) |
| `user_roles` | Security role assignments |
| `companies` | Multi-tenant companies |
| `booking_requests` | Meeting request records |
| `meeting_types` | Meeting type definitions |
| `rooms` | Conference room definitions |
| `presets` | Scheduling presets |
| `scheduler_mappings` | Staff-scheduler relationships |

### Integration Tables
| Table | Purpose |
|-------|---------|
| `google_connections` | Google Calendar OAuth tokens |
| `lawmatics_connections` | Lawmatics OAuth tokens |

### Key Columns - users table
- `auth_user_id` (UUID) - Links to auth.users
- `company_id` (UUID) - Company association
- `role` (text) - Business role (Owner/Admin/Attorney/SupportStaff)
- `approved` (boolean) - Staff approval status

### Key Columns - companies table
- `registration_code` - Owner signup code
- `invite_code` - Staff invite code
- `owner_id` - Links to users.id

---

## Critical Files

### Authentication & Routing
- `src/App.tsx` - Route definitions and guards
- `src/contexts/AuthContext.tsx` - Auth state management
- `src/components/auth/StaffRoute.tsx` - Staff guard
- `src/components/admin/AdminRoute.tsx` - Admin guard
- `src/components/auth/SuperuserRoute.tsx` - Superuser guard

### API Layer
- `src/lib/supabase.ts` - Supabase client
- `src/api/` - API call functions

### Key Components
- `src/pages/manager/ManagerDashboard.tsx` - Superuser interface
- `src/pages/admin/*.tsx` - Admin interfaces
- `src/pages/Dashboard.tsx` - Staff dashboard

---

## Test Accounts

### Existing Superuser
| Email | Role |
|-------|------|
| jonathan@legaleasemarketing.com | Superuser |

### Test Accounts (To Create)
| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Owner | test-owner@test.com | TestPass123! | Needs registration code, auto-approved |
| Admin | test-admin@test.com | TestPass123! | Needs invite code + promotion |
| Attorney | test-attorney@test.com | TestPass123! | Needs invite code + role change |
| Support Staff | test-support@test.com | TestPass123! | Needs invite code (default role) |
| Client | test-client@test.com | TestPass123! | Direct signup |

### How to Create Test Accounts

**Step 1: Get Company Codes**
1. Login as superuser (jonathan@legaleasemarketing.com)
2. Navigate to `/manager` -> Companies
3. Copy the Registration Code and Invite Code for the test company

**Step 2: Create Owner Account**
1. Go to `/auth` -> Sign Up
2. Select "Owner" role
3. Enter registration code
4. Creates: test-owner@test.com (auto-approved, admin security role)

**Step 3: Create Staff Accounts**
1. Go to `/auth` -> Sign Up
2. Select "Employee" role
3. Enter invite code
4. Create accounts (will need approval):
   - test-attorney@test.com
   - test-support@test.com
   - test-admin@test.com

**Step 4: Approve Staff Accounts**
1. Login as superuser or owner
2. Navigate to user management
3. Approve all pending staff accounts
4. Adjust business roles as needed (Attorney, Admin)

**Step 5: Create Client Account**
1. Sign up with no code (goes to default company)
2. Assign client security role via superuser

---

## Signup Flow Logic

From `handle_new_user_signup()` trigger:

1. **Owner Signup** (is_owner=true):
   - Requires valid registration_code
   - Creates user with role='Owner', approved=true
   - Assigns security role='admin'
   - Sets as company owner

2. **Staff Signup** (is_owner=false, has invite_code):
   - Joins company matching invite_code
   - Creates user with role='SupportStaff', approved=false
   - Assigns security role='staff'

3. **Default Signup** (no code):
   - Joins default company (UUID ...0001)
   - Creates user with role='SupportStaff', approved=false
   - Assigns security role='staff'

---

## Notes

- All staff users require approval before accessing the app (redirected to `/pending-approval`)
- Owners are auto-approved via registration code
- Business roles (Owner/Admin/Attorney/SupportStaff) are in `users.role`
- Security roles (admin/staff/client/superuser) are in `user_roles.role`
- Company scoping is enforced via RLS policies
