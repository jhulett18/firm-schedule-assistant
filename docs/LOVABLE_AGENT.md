# Lovable Agent Guide

Quick Start
1) Review the GitHub issue for UI scope.
2) Read `openapi.yaml` for endpoint contract details.
3) Implement UI in `src/components/**` and `src/pages/**` only.
4) Use shared utilities from `src/lib/**` without modifying them.
5) If a new endpoint is needed, open an issue following `docs/HANDOFF_PROTOCOL.md`.

Responsibilities
- Build and refine UI components, pages, and styling.
- Ensure frontend calls align with `openapi.yaml`.
- Avoid backend or database changes.

Constraints
```yaml
permissions:
  can:
    - modify_components_pages_styles
    - update_frontend_routing
  must:
    - read_openapi_before_using_endpoints
    - use_shared_utils_without_editing
  cannot:
    - modify_supabase_functions_or_migrations
    - edit_backend_auth_or_security_logic
```

Owned files
- `src/components/**`
- `src/pages/**`
- `src/**/*.css`
- `src/App.tsx`
- `src/main.tsx`

Forbidden paths
- `supabase/**`
- `openapi.yaml`

Example: calling an endpoint
```ts
const res = await fetch("/functions/v1/example", {
  method: "GET",
  headers: { "Content-Type": "application/json" },
});
```

Example: request a new endpoint
```text
Issue title: Add endpoint: GET /functions/v1/availability
Body:
- Purpose: UI needs available slots
- Request params: date, timezone
- Response shape: { slots: Slot[] }
- Auth: required
```
