# Current-state specifications

Status: **current as of 2026-06-26 code inspection**.

These specs document the behavior that exists in the repository now. They are meant to be the source of truth for future changes: update the relevant spec before or with any implementation change.

## Specs

- [Application architecture](./app-architecture.md)
- [Authentication and routing](./auth-routing.md)
- [Chat threads and local persistence](./chat-threads-ui.md)
- [API streaming and observability](./api-streaming-observability.md)
- [SQL agent and database tools](./sql-agent-tools.md)
- [Clarification flow](./clarification-flow.md)
- [Result rendering](./result-rendering.md)
- [Retail data import](./retail-data-import.md)
- [Business knowledge selection](./business-knowledge-selection.md)

## Important current-state notes

- Chat history is currently stored in **per-user browser localStorage** via Zustand (`lib/chat-store.ts`). The code comment says this replaces Assistant Cloud thread persistence.
- `.env.example` still keeps an unused `NEXT_PUBLIC_ASSISTANT_BASE_URL`; no current app code reads it. The top-level `README.md` matches the current AI SDK + local-persistence code path and no longer documents Assistant Cloud as an active integration.
- The protected-route file is `proxy.ts`, not `middleware.ts`.
- There is no dedicated test suite in the current repo. The available checks are `npm run build` and `npm run lint` (which runs `oxlint && oxfmt --check`; `npm run format` / `npm run lint:fix` are also available). The linter is oxlint/oxfmt, not ESLint.
