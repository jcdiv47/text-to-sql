# API streaming and observability spec

## Status

Implemented / current state.

## Goal

Expose a protected chat API that streams AI SDK v6 UI messages from the Mastra SQL agent and records observability metadata.

## Relevant files

- `app/api/chat/route.ts`
- `mastra/index.ts`
- `mastra/workflows/sql-workflow.ts`
- `components/assistant-ui/thread.tsx`

## `/api/chat` contract

### Runtime

```ts
export const runtime = "nodejs";
export const maxDuration = 60;
```

The route expects a JSON request body compatible with AI SDK/Mastra chat streaming params. The frontend transport also injects `currentDate` (the user's local date as `YYYY-MM-DD`) into the body via `prepareSendMessagesRequest`.

### Authentication

The route calls Clerk `auth()` and requires `userId`.

- If absent: return `new Response("Unauthorized", { status: 401 })`.
- If present: continue to Mastra streaming.

### Session id extraction

The route derives a `sessionId` from the first non-empty string among:

1. `params.id`
2. `params.sessionId`
3. `params.threadId`

The AI SDK frontend currently passes the thread id as the `useChat` id, which is expected to arrive as one of these fields depending on transport serialization.

### Request context (current date)

Before streaming, the route resolves the current date and passes it to the agent via a Mastra `RequestContext`:

```ts
const currentDate =
  getStringValue(params.currentDate) ?? new Date().toISOString().slice(0, 10);
const requestContext = new RequestContext();
requestContext.set("currentDate", currentDate);
```

It prefers the browser-supplied `currentDate` (the user's local date) and falls back to the server's UTC date for older clients. `sql-agent` reads `requestContext.get("currentDate")` in its instructions to resolve relative time ranges (e.g. "today", "last month").

### Mastra stream invocation

The route calls:

```ts
handleChatStream({
  mastra,
  agentId: "sql-agent",
  params: {
    ...params,
    requestContext,
    tracingOptions: {
      ...params.tracingOptions,
      metadata: {
        ...params.tracingOptions?.metadata,
        userId,
        ...(sessionId ? { sessionId } : {}),
      },
    },
  },
  version: "v6",
  sendReasoning: true,
});
```

The response is returned with `createUIMessageStreamResponse({ stream })`.

## Observability

`mastra/index.ts` configures Mastra with:

- `serviceName: "text-to-sql"`
- `SamplingStrategyType.ALWAYS`
- `LangfuseExporter`
  - `environment: process.env.NODE_ENV`
  - `release: process.env.VERCEL_GIT_COMMIT_SHA`
  - `realtime: process.env.NODE_ENV === "development"`
- `SensitiveDataFilter` span output processor
- `PinoLogger` named `Mastra Text-to-SQL` at `info` level

`app/api/chat/route.ts` schedules `flushMastraObservability()` in a Next.js `after()` callback so traces are flushed after the response is created.

## Workflow registration

`mastra/workflows/sql-workflow.ts` defines and registers a `sql-workflow` that currently runs the SQL agent as one step and forwards `fullStream` chunks. The API route currently invokes the agent directly with `agentId: "sql-agent"`; the workflow exists for future/workflow-based entry points.

## Requirements

- `/api/chat` must run on Node.js, not the Edge runtime, because PostgreSQL and Mastra tooling require Node APIs.
- The API must stream AI SDK v6 UI messages.
- Reasoning parts must be sent so the frontend can render chain-of-thought/tool progress.
- Trace metadata must include `userId` and should include `sessionId` when available.
- Relative dates must resolve against the user's local `currentDate`, with a server UTC fallback.
- Observability flushing must not block creation of the streaming response.

## Error handling

- Authentication failure returns 401 before calling Mastra.
- Tool/model errors are expected to appear as stream errors or AI SDK error state on the frontend.
- The frontend displays `error.message || "出错了，请重试。"` above the composer.

## Manual verification

- Signed-out POST to `/api/chat` returns 401.
- Signed-in chat request streams text/tool/reasoning parts.
- Langfuse traces include Clerk `userId` and thread/session id when supplied.
- Stopping the frontend generation aborts the active request/tool chain.
