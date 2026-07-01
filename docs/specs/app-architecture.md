# Application architecture spec

## Status

Implemented / current state.

## Goal

Provide a protected web chat where authenticated users can ask natural-language questions about a PostgreSQL database and receive SQL-backed answers from a Mastra agent.

## Primary user flow

1. User opens `/`.
2. User signs in or clicks **Go to Chat**.
3. `/chat` renders the custom assistant UI.
4. User sends a message.
5. The frontend streams the request to `/api/chat` using AI SDK `useChat` and `DefaultChatTransport`.
6. `/api/chat` authenticates the user with Clerk, selects the most relevant predefined business knowledge for the question (on fresh turns) and injects it into the agent context, and streams the Mastra `sql-workflow` as an AI SDK v6 UI message response.
7. The workflow runs the SQL agent (schema introspection, optional clarification via workflow suspend/resume, verified data-gap reporting, and safe read-only SQL) which finalizes with a structured brief; the answer agent then writes the final user-facing reply from that brief.
8. The frontend renders reasoning/tool calls in a collapsible chain of thought and renders final prose/markdown tables through `QueryResult`.

## Major components

| Area               | Files                                                                                        | Current behavior                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell          | `app/layout.tsx`, `app/globals.css`                                                          | Dark-themed Next.js app with Clerk, Convex, and shared tooltip providers.                                                                                   |
| Landing/auth pages | `app/page.tsx`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx` | Public landing page and embedded Clerk sign-in/sign-up routes.                                                                                              |
| Route protection   | `proxy.ts`                                                                                   | Protects `/chat(.*)` and `/api(.*)`.                                                                                                                        |
| Chat page          | `app/chat/page.tsx`, `app/assistant.tsx`                                                     | Protected full-height assistant UI with sidebar, header, thread list, and active thread.                                                                    |
| Chat runtime       | `components/assistant-ui/thread.tsx`                                                         | Uses `useChat` with `/api/chat`; supports streaming, stop, regenerate, copy, suggestions, and clarify gating.                                               |
| Thread persistence | `convex/schema.ts`, `convex/threads.ts`, `convex/messages.ts`, `lib/chat-registry.ts`        | Clerk-scoped Convex threads/messages plus a tab-local live AI SDK `Chat` registry that persists settled turns.                                              |
| API                | `app/api/chat/route.ts`                                                                      | Authenticates, streams the Mastra `sql-workflow`, returns streaming UI messages, flushes observability after response.                                      |
| Workflow           | `mastra/workflows/sql-workflow.ts`                                                           | Two steps — `run-sql-agent` (with native clarify suspend/resume) then `run-answer-agent` — streamed into one assistant message.                             |
| Agents             | `mastra/agents/sql-agent.ts`, `mastra/agents/answer-agent.ts`                                | SQL agent (OpenRouter Kimi K2.6, five tools) grounds/queries and finalizes a brief; answer agent (OpenRouter gpt-oss-120b, no DB) writes the reply from it. |
| Business knowledge | `mastra/agents/business-knowledge-agent.ts`, `mastra/knowledge/*.ts`                         | Selector agent picks up to 5 relevant items from a predefined catalog per question; injected into `sql-agent` via `requestContext`.                         |
| Tools              | `mastra/tools/*.ts`                                                                          | PostgreSQL schema introspection, safe SELECT execution, choice-based clarification, structured data-gap reporting, and the finalize-sql-answer handoff.     |
| Rendering          | `components/assistant-ui/markdown-text.tsx`, `query-result.tsx`, `sql-tools.tsx`             | Markdown, SQL highlighting, tool cards, scrollable tables, and SVG chart toggles.                                                                           |

## Runtime and dependencies

- Next.js app router, React 19, TypeScript.
- Clerk for authentication.
- Convex for Clerk-scoped server-side chat persistence.
- AI SDK v6 UI message streaming via `@ai-sdk/react` and `ai`.
- Mastra for agent/tool orchestration.
- PostgreSQL via `pg`.
- Langfuse exporter through Mastra observability.
- Tailwind CSS v4 with shadcn-style UI primitives.
- Zustand for in-memory selected-thread and per-thread status UI state.

## Environment variables

| Variable                            |             Required by current code | Used by                                                                      |
| ----------------------------------- | -----------------------------------: | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |                                  yes | Clerk frontend provider.                                                     |
| `CLERK_SECRET_KEY`                  |                                  yes | Clerk server auth.                                                           |
| `NEXT_PUBLIC_CONVEX_URL`            |                                  yes | Convex React client.                                                         |
| `NEXT_PUBLIC_CONVEX_SITE_URL`       |                  generated by Convex | Convex deployment metadata.                                                  |
| `CONVEX_DEPLOYMENT`                 |                  generated by Convex | Convex CLI/deployment selection.                                             |
| `CLERK_JWT_ISSUER_DOMAIN`           |               yes in Convex env only | Convex Clerk JWT validation for the `convex` JWT template.                   |
| `OPENROUTER_API_KEY`                |                                  yes | Mastra/OpenRouter model provider.                                            |
| `DATABASE_URL`                      |                 yes for SQL features | PostgreSQL client.                                                           |
| `DATABASE_SCHEMA`                   | optional, defaults to `aiqa` in code | Database introspection and execution scoping.                                |
| `MASTRA_DATABASE_URL`               |     for clarification suspend/resume | Mastra workflow snapshot storage (separate Postgres DB from `DATABASE_URL`). |
| `LANGFUSE_PUBLIC_KEY`               |                 expected for tracing | Langfuse exporter.                                                           |
| `LANGFUSE_SECRET_KEY`               |                 expected for tracing | Langfuse exporter.                                                           |
| `LANGFUSE_BASE_URL`                 |                 optional/defaultable | Langfuse exporter.                                                           |

## Non-goals in current state

- No Mastra memory adapter.
- No Assistant Cloud runtime integration in current code path.
- No live cross-tab/thread conflict resolution for concurrent edits to the same conversation.
- No multi-database selection UI.
- No write/mutation SQL support.
- No dedicated automated test suite.

## Acceptance criteria for current behavior

- `/` is public and shows landing/auth controls.
- `/chat` renders only for authenticated users.
- A chat message reaches `/api/chat` and streams assistant UI message parts.
- SQL tool calls are visible in the chain-of-thought panel.
- Final markdown tables render through `QueryResult` when parseable.
- Thread history survives browser refresh for the same Clerk user and is stored server-side in Convex.
- Verified data gaps render as dedicated tool cards and are acknowledged in the final answer.
