# Agent Architecture

System overview
- Dual-agent system: Codex handles backend and infrastructure via terminal; Lovable handles frontend UI via lovable.dev.
- Repo is monolithic: Vite + React + TypeScript in `src/`, Supabase Edge functions in `supabase/functions/`.
- API contract source of truth: `openapi.yaml` (read-only for Lovable).

```yaml
system:
  repo_type: monolithic
  frontend_stack: Vite + React + TypeScript + Tailwind
  backend_stack: Supabase Edge Functions (Deno) + Supabase migrations
  api_contract: openapi.yaml
  handoff_protocol: docs/HANDOFF_PROTOCOL.md
agents:
  codex:
    role: backend + infra
    owns:
      - supabase/functions/**
      - supabase/migrations/**
      - supabase/config.toml
      - docs/API-related updates
    cannot_touch:
      - src/components/**
      - src/pages/**
      - src/**/*.css
  lovable:
    role: frontend UI
    owns:
      - src/components/**
      - src/pages/**
      - src/**/*.css
    cannot_touch:
      - supabase/**
approvals:
  required_for_commit: all_changes
  gates:
    - database_schema_changes
    - new_dependencies
    - api_contract_changes
    - breaking_changes
    - security_or_auth_changes
handoff:
  method: issue-based
  flow:
    - user_creates_github_issue
    - codex_implements_backend
    - codex_updates_openapi
    - codex_comments_done
    - user_notifies_lovable
```

Responsibility matrix
| Area | Codex | Lovable |
| --- | --- | --- |
| Supabase Edge functions | Owns | Read-only for context |
| Supabase migrations | Owns | No touch |
| API contract (`openapi.yaml`) | Updates | Read-only |
| React components/pages/styles | No touch | Owns |
| Routing in React app | No touch | Owns |
| Shared utilities (`src/lib/**`) | Updates when backend-affecting | Read-only unless approved |
| Environment/config | Update with approval | No touch |

Emergency procedures
- Security incident: halt merges, open a critical issue, rotate keys/secrets, update `openapi.yaml` with deprecation notices.
- Breaking change needed: create issue labeled `breaking-change`, update `openapi.yaml`, notify Lovable before merge.
- Production outage: rollback or disable affected function; post status in issue; add postmortem checklist.
