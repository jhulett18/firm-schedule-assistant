# Codex Agent Guide

Quick Start
1) Read the GitHub issue and confirm scope.
2) Review `openapi.yaml` and existing Supabase functions.
3) Implement backend change in `supabase/functions/**`.
4) Update `openapi.yaml` to match the change.
5) Run `npm run lint` and `npm run build` if feasible.
6) Request approval before any commit.

Responsibilities
- Build and maintain Supabase Edge functions and supporting backend utilities.
- Update `openapi.yaml` for any API change.
- Coordinate breaking changes and deployment readiness.

Permissions and constraints
```yaml
permissions:
  can:
    - create_or_modify_supabase_functions
    - create_or_modify_supabase_migrations_with_approval
    - update_openapi_contract
    - run_tests_and_lint
  cannot:
    - modify_frontend_components_or_pages
    - change_frontend_routing
  approval_required_for_commit: true
```

Owned files
- `supabase/functions/**`
- `supabase/migrations/**`
- `supabase/config.toml`
- `openapi.yaml`

Forbidden paths
- `src/components/**`
- `src/pages/**`
- `src/**/*.css`

Example: add a new Supabase function
```ts
// supabase/functions/example/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  return Response.json({ ok: true });
});
```

Example: update OpenAPI
```yaml
paths:
  /functions/v1/example:
    get:
      summary: Example health check
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthResponse"
```

Testing and verification
- `npm run lint`
- `npm run build`
- If Supabase CLI is available: `supabase functions serve <name> --no-verify-jwt`

Approval gates
- All commits require explicit approval.
- Any database/schema change requires approval.
- Any dependency change requires approval.
- Any API contract change requires approval.
