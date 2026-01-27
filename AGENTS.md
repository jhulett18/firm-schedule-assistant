# Agent Architecture

## System Overview

This project uses a multi-agent system with two AI toolchains:

| Tool | Purpose | Invocation |
|------|---------|------------|
| **Claude Code** | Orchestration, backend setup, frontend prompts | `claude --agent <name>` |
| **Codex CLI** | Backend continuation, deep implementation | `codex "<prompt>"` |

```
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              LOVABLE ORCHESTRATOR (Claude)                  │
│              claude --agent lovable                         │
│                                                             │
│  Routes requests to:                                        │
│  • clb → Backend setup/new features                         │
│  • plf → Frontend prompt generation                         │
│  • Codex → Continuation from handoff                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│     clb     │   │     plf     │   │   Codex     │
│  (Claude)   │   │  (Claude)   │   │   (CLI)     │
│             │   │             │   │             │
│ Backend dev │   │ UI prompts  │   │ Continue    │
│ OpenAPI     │   │ for Lovable │   │ from handoff│
└─────────────┘   └─────────────┘   └─────────────┘
```

## Claude Code Agents

### lovable (Orchestrator)
**Invocation:** `claude --agent lovable`

The default handler. Analyzes user requests and routes to specialists:
- Backend requests → `clb`
- Frontend requests → `plf`
- Continuation requests → Directs to Codex CLI
- Status requests → Handles directly

### clb (Claude Lovable Backend)
**Invocation:** `claude --agent clb`

Backend development agent:
- Creates Supabase Edge Functions
- Updates `openapi.yaml` API contract
- Manages database migrations
- Creates handoff files when stopping mid-task

### plf (Prompt Lovable Frontend)
**Invocation:** `claude --agent plf`

Frontend prompt generator:
- Reads `openapi.yaml` for API contract
- Generates prompts for Lovable.dev
- Focuses on UI components and pages

## Codex CLI

**Invocation:** `codex "<prompt>"`

Used for continuation and deep backend implementation:
1. Read `.lovable/HANDOFF.md` for context
2. Pass summary to Codex
3. Codex continues the work

See `docs/CODEX_REFERENCE.md` for full usage guide.

## Handoff System

Agents communicate via files in `.lovable/`:

```
.lovable/
├── TASKS.md           # Project task list and progress
├── HANDOFF.md         # Context for continuing previous work
└── FRONTEND_SIGNAL.md # Backend ready, UI work can proceed
```

### Workflow

```
1. Start backend work
   └── claude --agent clb "implement auth endpoint"
   └── clb creates/updates .lovable/TASKS.md
   └── clb updates openapi.yaml

2. If stopping mid-task
   └── clb creates .lovable/HANDOFF.md with context

3. Continue with Codex
   └── cat .lovable/HANDOFF.md
   └── codex "Continue: [summary from handoff]"

4. When backend ready for UI
   └── Create .lovable/FRONTEND_SIGNAL.md
   └── claude --agent plf "generate login UI prompt"
```

## File Ownership

| Domain | Owner | Files |
|--------|-------|-------|
| Backend | clb / Codex | `supabase/functions/**`, `supabase/migrations/**`, `openapi.yaml` |
| Frontend | plf / Lovable.dev | `src/components/**`, `src/pages/**`, `src/**/*.css` |
| Shared | Read-only cross-access | `src/lib/**` |
| Config | Approval required | `supabase/config.toml`, environment files |

## Tech Stack

```yaml
frontend:
  framework: Vite + React + TypeScript
  styling: Tailwind CSS
  location: src/

backend:
  runtime: Supabase Edge Functions (Deno)
  database: Supabase (PostgreSQL)
  location: supabase/functions/, supabase/migrations/

contract:
  file: openapi.yaml
  owner: Backend agents
  consumers: Frontend agents (read-only)
```

## Approval Gates

All commits require explicit approval for:
- Database schema changes
- New dependencies
- API contract changes (`openapi.yaml`)
- Breaking changes
- Security or authentication changes

## Emergency Procedures

**Security incident:**
1. Halt all merges
2. Open critical issue
3. Rotate keys/secrets
4. Update `openapi.yaml` with deprecation notices

**Breaking change:**
1. Create issue labeled `breaking-change`
2. Update `openapi.yaml` with versioning
3. Notify frontend before merge

**Production outage:**
1. Rollback or disable affected function
2. Post status in issue
3. Add postmortem checklist

## Quick Reference

```bash
# Check project status
claude --agent lovable "what's the status?"

# Start new backend feature
claude --agent clb "add user profile endpoint"

# Continue previous work
cat .lovable/HANDOFF.md
codex "Continue from handoff: [paste summary]"

# Generate frontend prompt
claude --agent plf "create settings page UI"
```

## Related Docs

- `docs/CODEX_REFERENCE.md` - Codex CLI usage guide
- `docs/AGENT_SYSTEM_SUMMARY.md` - Quick reference
- `docs/HANDOFF_PROTOCOL.md` - Issue-based handoff details
- `docs/CODEX_AGENT.md` - Codex responsibilities
- `docs/LOVABLE_AGENT.md` - Lovable responsibilities
