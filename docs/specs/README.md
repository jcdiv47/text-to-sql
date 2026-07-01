# Current-state specifications

Status: **current as of 2026-07-01 code inspection**.

These specs document the behavior that exists in the repository now. They are meant to be the source of truth for future changes: update the relevant spec before or with any implementation change.

## Specs

- [Application architecture](./app-architecture.md)
- [Authentication and routing](./auth-routing.md)
- [Chat threads and Convex persistence](./chat-threads-ui.md)
- [API streaming and observability](./api-streaming-observability.md)
- [SQL agent and database tools](./sql-agent-tools.md)
- [Answer agent](./answer-agent.md)
- [Clarification flow](./clarification-flow.md)
- [Result rendering](./result-rendering.md)
- [Retail data import](./retail-data-import.md)
- [Business knowledge selection](./business-knowledge-selection.md)

## Important current-state notes

- The `/api/chat` pipeline is a Mastra **`sql-workflow`** (not a direct agent call): `run-sql-agent` (with native clarify **suspend/resume**, which needs `MASTRA_DATABASE_URL`) then `run-answer-agent`. The SQL agent finalizes a structured brief via `finalize-sql-answer`; the answer agent writes the user-facing reply.
- Chat history is currently stored **server-side in Convex**, scoped to the Clerk user. Zustand is only used for in-memory UI state such as selected thread and live status.
- `.env.example` contains Convex variables written by `npx convex dev`; `CLERK_JWT_ISSUER_DOMAIN` must be set in the Convex deployment environment for Clerk JWT validation.
- The protected-route file is `proxy.ts`, not `middleware.ts`.
- There is no dedicated test suite in the current repo. The available checks are `npm run build` and `npm run lint` (which runs `oxlint && oxfmt --check`; `npm run format` / `npm run lint:fix` are also available). The linter is oxlint/oxfmt, not ESLint.
