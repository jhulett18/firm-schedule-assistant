# Handoff Protocol

Method: Issue-based

New endpoint request workflow
1) User opens a GitHub issue with the endpoint request details.
2) Codex implements the endpoint in `supabase/functions/**`.
3) Codex updates `openapi.yaml` to match the implementation.
4) Codex comments on the issue with testing notes and status.
5) User notifies Lovable to proceed with UI integration.

Breaking change notification
- Create or update an issue labeled `breaking-change`.
- Codex updates `openapi.yaml` with deprecation notes and versioning info.
- Lovable waits for confirmation before merging UI changes.

Shared type modification rules
- Shared types live in `src/lib/**`.
- Codex may update for backend-driven changes; Lovable reads only.
- Any shared type change must be noted in the issue and `openapi.yaml` if applicable.

Deployment coordination
- Codex posts a readiness comment including tests run.
- User approves commit; deployment happens after approval.
