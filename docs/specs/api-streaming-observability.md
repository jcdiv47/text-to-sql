# API streaming and observability spec

## Status

Implemented / current state.

## Goal

Expose a protected chat API that streams AI SDK v6 UI messages from the Mastra SQL agent and records observability metadata.

## Relevant files

- `app/api/chat/route.ts`
- `mastra/knowledge/select-business-knowledge.ts`
- `mastra/agents/business-knowledge-agent.ts`
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

In normal app routing, `proxy.ts` protects `/api(.*)` and redirects unauthenticated HTTP requests to `/sign-in` before this handler runs. The 401 check is the route's defense-in-depth behavior when the handler is reached without a user.

### Session id extraction

The route derives a `sessionId` from the first non-empty string among:

1. `params.id`
2. `params.sessionId`
3. `params.threadId`

The AI SDK frontend currently passes the thread id as the `useChat` id, which is expected to arrive as one of these fields depending on transport serialization.

### Request context (current date + business knowledge)

Before streaming, the route builds a Mastra `RequestContext` with the current date and the selected business knowledge:

```ts
const currentDate =
  getStringValue(params.currentDate) ?? new Date().toISOString().slice(0, 10);
const businessKnowledge = await selectBusinessKnowledge({
  question: getLatestUserQuestion(params.messages),
  userId,
  sessionId,
  signal: req.signal,
});
const requestContext = new RequestContext();
requestContext.set("currentDate", currentDate);
requestContext.set("businessKnowledge", businessKnowledge);
```

It prefers the browser-supplied `currentDate` (the user's local date) and falls back to the server's UTC date for older clients. `sql-agent` reads `requestContext.get("currentDate")` to resolve relative time ranges (e.g. "today", "last month").

`selectBusinessKnowledge` runs the `business-knowledge-agent` over the latest user question and returns a markdown block of the most relevant predefined knowledge, which `sql-agent` reads from `requestContext.get("businessKnowledge")` and renders under `## 相关业务知识`. It runs before streaming (one serial model call) bounded by an 8s timeout combined with the request's abort signal, carries the same `userId`/`sessionId` tracing metadata, and is best-effort — any failure, timeout, or abort yields an empty block, so selection can neither block nor fail the turn. See [Business knowledge selection](./business-knowledge-selection.md).

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
- Business-knowledge selection runs before streaming, bounded by a timeout combined with the request's abort signal, and must degrade to an empty block on failure/timeout/abort, never blocking the turn.
- Relative dates must resolve against the user's local `currentDate`, with a server UTC fallback.
- Observability flushing must not block creation of the streaming response.

## Error handling

- Authentication failure inside the route returns 401 before calling Mastra; normal proxy-routed signed-out HTTP requests are redirected before the route runs.
- Tool/model errors are expected to appear as stream errors or AI SDK error state on the frontend.
- The frontend displays `error.message || "出错了，请重试。"` above the composer.

## Manual verification

- Signed-out POST to `/api/chat` through normal app routing redirects to `/sign-in` with `redirect_url`.
- Route-handler invocation without `userId` returns 401.
- Signed-in chat request streams text/tool/reasoning parts.
- Langfuse traces include Clerk `userId` and thread/session id when supplied.
- Langfuse shows a `business-knowledge-agent` selection call carrying matching `userId`/`sessionId`.
- Stopping the frontend generation aborts the active request/tool chain.
