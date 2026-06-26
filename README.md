# Text-to-SQL Assistant

A protected Next.js chat app where authenticated users ask natural-language questions about a PostgreSQL database and get SQL-backed answers from an in-process [Mastra](https://mastra.ai) agent. Built with [Clerk](https://clerk.com) for auth, the [AI SDK](https://sdk.vercel.ai) for UI message streaming, and [Langfuse](https://langfuse.com) for observability.

## How it works

1. `/` is a public landing page. `/chat` and `/api/*` require a signed-in Clerk user (`proxy.ts`).
2. The chat UI streams messages to `/api/chat` via AI SDK `useChat` + `DefaultChatTransport`.
3. `/api/chat` authenticates the request, invokes the Mastra `sql-agent`, and streams AI SDK v6 UI messages back.
4. The agent introspects the schema, optionally asks choice-based clarification questions, runs a read-only `SELECT`, and writes the answer. Reasoning and tool calls render in a collapsible chain-of-thought; tables/charts render through `QueryResult`.

Chat history is persisted **per user in the browser's `localStorage`** (Zustand, `lib/chat-store.ts`). There is no server-side persistence, Mastra Memory adapter, or Assistant Cloud integration in the current code path.

## Tech stack

- Next.js App Router, React 19, TypeScript
- Clerk authentication
- AI SDK v6 UI message streaming (`@ai-sdk/react`, `ai`)
- Mastra agent/tool orchestration over OpenRouter (Kimi K2.6)
- PostgreSQL via `pg`
- Langfuse exporter through Mastra observability
- Tailwind CSS v4 with shadcn-style UI primitives
- Zustand for browser-local thread persistence

## Getting started

### 1. Configure environment variables

```bash
cp .env.example .env.local
```

Set the following:

| Variable | Required | Used by |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk frontend provider |
| `CLERK_SECRET_KEY` | yes | Clerk server auth |
| `OPENROUTER_API_KEY` | yes | Mastra / OpenRouter model provider |
| `DATABASE_URL` | yes (for SQL features) | PostgreSQL client |
| `DATABASE_SCHEMA` | optional (defaults to `aiqa`) | Schema scope for introspection and execution |
| `LANGFUSE_PUBLIC_KEY` | for tracing | Langfuse exporter |
| `LANGFUSE_SECRET_KEY` | for tracing | Langfuse exporter |
| `LANGFUSE_BASE_URL` | optional | Langfuse exporter |

> `NEXT_PUBLIC_ASSISTANT_BASE_URL` still appears in `.env.example` but is **not used** by the current code.

### 2. Install dependencies and run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

- Click **Go to Chat**. Signed out, you're redirected to the embedded sign-in page (with `redirect_url`); after sign-in you return to `/chat`.

### 3. (Optional) Import sample retail data

If you have `data/malls.csv` and `data/stores.csv`, import them into the configured schema:

```bash
npm run db:import-retail               # imports to *_import_test tables
node data/scripts/import-retail-data.mjs --live --confirm   # imports to live malls/stores
```

The script loads `.env` (not `.env.local`) and requires `DATABASE_URL` and `DATABASE_SCHEMA`. See [`docs/specs/retail-data-import.md`](docs/specs/retail-data-import.md).

## Project structure

| Path | Purpose |
|---|---|
| `app/page.tsx` | Public landing page (auth controls, "Go to Chat") |
| `app/chat/page.tsx`, `app/assistant.tsx` | Protected chat shell; rehydrates the per-user local chat store |
| `app/api/chat/route.ts` | Streams responses from the Mastra SQL agent (Node runtime), flushes observability after |
| `app/sign-in/…`, `app/sign-up/…` | Embedded Clerk auth routes |
| `app/layout.tsx` | App wrapper with `ClerkProvider` (dark theme, embedded routes) |
| `proxy.ts` | Route protection — protects `/chat(.*)` and `/api(.*)`, keeps `/` public |
| `lib/chat-store.ts` | Per-Clerk-user `localStorage` thread persistence (Zustand) |
| `components/assistant-ui/` | Thread UI, chain-of-thought, SQL tool cards, markdown, `QueryResult` tables/charts |
| `mastra/agents/` | `sql-agent` and `clarify-agent` |
| `mastra/tools/` | `introspect-database`, `execute-sql`, `clarify-request`, Postgres client helpers |
| `mastra/index.ts` | Mastra instance, Langfuse exporter, logger |

## Checks

```bash
npm run build   # Next.js production build
npm run lint    # oxlint && oxfmt --check
npm run lint:fix # oxlint --fix && oxfmt
```

There is no dedicated automated test suite. Linting/formatting use oxlint and oxfmt (not ESLint).

## Documentation

Current-state specifications live in [`docs/specs/`](docs/specs/README.md) and are the source of truth for behavior. Update the relevant spec before or alongside any implementation change.
