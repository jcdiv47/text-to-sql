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
6. `/api/chat` authenticates the user with Clerk, invokes the Mastra `sql-agent`, and streams an AI SDK v6 UI message response.
7. The SQL agent introspects the PostgreSQL schema, optionally asks for clarification, executes safe read-only SQL, and writes a final answer.
8. The frontend renders reasoning/tool calls in a collapsible chain of thought and renders final prose/markdown tables through `QueryResult`.

## Major components

| Area | Files | Current behavior |
|---|---|---|
| App shell | `app/layout.tsx`, `app/globals.css` | Dark-themed Next.js app with Clerk provider and shared tooltip provider. |
| Landing/auth pages | `app/page.tsx`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx` | Public landing page and embedded Clerk sign-in/sign-up routes. |
| Route protection | `proxy.ts` | Protects `/chat(.*)` and `/api(.*)`. |
| Chat page | `app/chat/page.tsx`, `app/assistant.tsx` | Protected full-height assistant UI with sidebar, header, thread list, and active thread. |
| Chat runtime | `components/assistant-ui/thread.tsx` | Uses `useChat` with `/api/chat`; supports streaming, stop, regenerate, copy, suggestions, and clarify gating. |
| Thread store | `lib/chat-store.ts` | Per-Clerk-user localStorage persistence for thread metadata and AI SDK UI messages. |
| API | `app/api/chat/route.ts` | Authenticates, calls Mastra `sql-agent`, returns streaming UI messages, flushes observability after response. |
| Agent | `mastra/agents/sql-agent.ts` | Text-to-SQL Mastra agent using OpenRouter Kimi K2.6 and three tools. |
| Tools | `mastra/tools/*.ts` | PostgreSQL schema introspection, safe SELECT execution, and choice-based clarification. |
| Rendering | `components/assistant-ui/markdown-text.tsx`, `query-result.tsx`, `sql-tools.tsx` | Markdown, SQL highlighting, tool cards, scrollable tables, and SVG chart toggles. |

## Runtime and dependencies

- Next.js app router, React 19, TypeScript.
- Clerk for authentication.
- AI SDK v6 UI message streaming via `@ai-sdk/react` and `ai`.
- Mastra for agent/tool orchestration.
- PostgreSQL via `pg`.
- Langfuse exporter through Mastra observability.
- Tailwind CSS v4 with shadcn-style UI primitives.
- Zustand for browser-local thread persistence.

## Environment variables

| Variable | Required by current code | Used by |
|---|---:|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk frontend provider. |
| `CLERK_SECRET_KEY` | yes | Clerk server auth. |
| `OPENROUTER_API_KEY` | yes | Mastra/OpenRouter model provider. |
| `DATABASE_URL` | yes for SQL features | PostgreSQL client. |
| `DATABASE_SCHEMA` | optional, defaults to `aiqa` in code | Database introspection and execution scoping. |
| `LANGFUSE_PUBLIC_KEY` | expected for tracing | Langfuse exporter. |
| `LANGFUSE_SECRET_KEY` | expected for tracing | Langfuse exporter. |
| `LANGFUSE_BASE_URL` | optional/defaultable | Langfuse exporter. |
| `NEXT_PUBLIC_ASSISTANT_BASE_URL` | no current usage | Present in `.env.example` only. |

## Non-goals in current state

- No server-side chat persistence or Mastra memory adapter.
- No Assistant Cloud runtime integration in current code path.
- No multi-database selection UI.
- No write/mutation SQL support.
- No dedicated automated test suite.

## Acceptance criteria for current behavior

- `/` is public and shows landing/auth controls.
- `/chat` renders only for authenticated users.
- A chat message reaches `/api/chat` and streams assistant UI message parts.
- SQL tool calls are visible in the chain-of-thought panel.
- Final markdown tables render through `QueryResult` when parseable.
- Thread history survives browser refresh for the same Clerk user on the same device.
