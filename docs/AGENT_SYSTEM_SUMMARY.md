# Agent System Summary

Quick reference for how the multi-agent system works in this project.

## Agents Overview

| Agent | Invocation | Purpose |
|-------|------------|---------|
| `lovable` | `claude --agent lovable` | **Orchestrator** - routes requests to specialists |
| `clb` | `claude --agent clb` | Backend development (Supabase functions, migrations, OpenAPI) |
| `plf` | `claude --agent plf` | Generates Lovable frontend prompts |

**For continuation:** Use Codex CLI with `.lovable/HANDOFF.md` context (see `docs/CODEX_REFERENCE.md`)

## Handoff Mechanism

The agents communicate via files in `.lovable/`:

```
.lovable/
├── TASKS.md           # Project task list and progress
├── HANDOFF.md         # Pending continuation context from previous session
└── FRONTEND_SIGNAL.md # Backend ready, UI work can proceed
```

### Typical Flow

```
1. User invokes clb for backend work
   └── clb implements backend, updates openapi.yaml
   └── clb creates FRONTEND_SIGNAL.md when done

2. User continues with Codex or invokes plf
   └── Codex reads HANDOFF.md for context
   └── plf generates frontend prompts
```

## Key Points

- **Agents don't auto-chain** - you manually trigger the next agent
- **Handoff files are the bridge** - they preserve context between sessions
- **Codex CLI for continuation** - read `HANDOFF.md` and pass to Codex
- **OpenAPI is the contract** - source of truth for API coupling between frontend/backend
- **GitHub issues for coordination** - complex handoffs use issue-based protocol

## Ownership Boundaries

| Domain | Agent | Files |
|--------|-------|-------|
| Backend | clb / Codex | `supabase/**`, `openapi.yaml` |
| Frontend | plf | `src/components/**`, `src/pages/**` |
| Routing | lovable | Reads all, writes none |

## Common Commands

```bash
# Start backend work
claude --agent clb "implement user authentication endpoint"

# Continue from handoff (use Codex)
cat .lovable/HANDOFF.md  # read context first
codex "Continue from handoff: [summary]"

# Generate frontend prompt
claude --agent plf "create login page UI"

# Check project status
claude --agent lovable "what's the current status?"
```

## DAIC Mode (cc-sessions)

This repo uses Discussion-Alignment-Implementation-Check:

- **Discussion Mode** (default): Planning only, edit tools blocked
- **Implementation Mode**: User activates with trigger phrase, then tools available

Return to discussion after implementing:
```bash
sessions mode discussion
```
