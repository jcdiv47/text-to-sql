# API streaming and observability spec

## Status

Implemented / current state.

## Goal

Expose a protected chat API that streams AI SDK v6 UI messages from the Mastra `sql-workflow` (SQL agent + answer agent, with native clarify suspend/resume) and records observability metadata.

## Relevant files

- `app/api/chat/route.ts`
- `mastra/workflows/sql-workflow.ts`
- `mastra/knowledge/select-business-knowledge.ts`
- `mastra/agents/business-knowledge-agent.ts`
- `mastra/index.ts`
- `lib/chat-registry.ts`
- `components/assistant-ui/thread.tsx`

## `/api/chat` contract

### Runtime

```ts
export const runtime = "nodejs";
export const maxDuration = 60;
```

The route expects a JSON request body compatible with AI SDK/Mastra chat streaming params. The frontend transport (`lib/chat-registry.ts`) builds the body explicitly and injects `currentDate` (the user's local date as `YYYY-MM-DD`).

### Two request shapes: fresh turn vs. resume

The transport sends one of two body shapes (see [Clarification flow](./clarification-flow.md)):

- **Fresh turn:** `{ id, inputData: { messages, trigger }, currentDate }`.
- **Resume** (continuing a suspended clarify run): `{ id, runId, resumeData: { answers }, currentDate }` — chat history is omitted because the workflow continues from its snapshot.

The route computes `isResume = Boolean(runId && params.resumeData)` and reads messages from `params.inputData?.messages ?? params.messages`.

### Authentication

The route calls Clerk `auth()` and requires `userId`.

- If absent: return `new Response("未登录", { status: 401 })`.
- If present: continue to Mastra streaming.

In normal app routing, `proxy.ts` protects `/api(.*)` and redirects unauthenticated HTTP requests to `/sign-in` before this handler runs. The 401 check is the route's defense-in-depth behavior when the handler is reached without a user.

### Session id extraction

The route derives a `sessionId` from the first non-empty string among:

1. `params.id`
2. `params.sessionId`
3. `params.threadId`

The AI SDK frontend passes the thread id as the `useChat` id, which is expected to arrive as one of these fields depending on transport serialization.

### Request context (current date + business knowledge)

Before streaming, the route builds a Mastra `RequestContext`:

```ts
const currentDate =
  getStringValue(params.currentDate) ?? new Date().toISOString().slice(0, 10);
const businessKnowledge = isResume
  ? ""
  : await selectBusinessKnowledge({
      question: getLatestUserQuestion(messages),
      userId,
      sessionId,
      signal: req.signal,
    });
const requestContext = new RequestContext();
requestContext.set("currentDate", currentDate);
requestContext.set("businessKnowledge", businessKnowledge);
```

It prefers the browser-supplied `currentDate` (the user's local date) and falls back to the server's UTC date for older clients. `sql-agent` reads `requestContext.get("currentDate")` to resolve relative time ranges (e.g. "today", "last month").

Business-knowledge selection is **skipped on resume** (`isResume ? "" : …`): the original turn's grounding is re-applied inside the workflow step from step state, so a resume request neither reselects nor needs it. On a fresh turn, `selectBusinessKnowledge` runs the `business-knowledge-agent` over the latest user question and returns a markdown block that `sql-agent` reads from `requestContext.get("businessKnowledge")` and renders under `## 相关业务知识`. It runs before streaming (one serial model call) bounded by an 8s timeout combined with the request's abort signal, carries the same `userId`/`sessionId` tracing metadata, and is best-effort — any failure, timeout, or abort yields an empty block, so selection can neither block nor fail the turn. See [Business knowledge selection](./business-knowledge-selection.md).

### Mastra stream invocation

The route streams the **workflow** (not the agent directly):

```ts
const stream = await handleWorkflowStream({
  mastra,
  workflowId: "sql-workflow",
  version: "v6",
  sendReasoning: true,
  params: isResume
    ? { runId, resumeData: params.resumeData, requestContext, tracingOptions }
    : {
        inputData: { messages, trigger: params.inputData?.trigger ?? params.trigger },
        requestContext,
        tracingOptions,
      },
});
return createUIMessageStreamResponse({ stream });
```

`tracingOptions` merges any client-supplied options with `metadata.userId` and `metadata.sessionId` (when available). `trigger` is read from `params.inputData?.trigger ?? params.trigger` because the transport nests it under `inputData` (a plain `params.trigger` read would miss it and break regenerate).

## The `sql-workflow`

`mastra/workflows/sql-workflow.ts` is the entry point. It is two steps chained `.then(runSqlAgentStep).then(runAnswerAgentStep)`; the whole run streams into a **single assistant UI message** (the workflow-to-AI-SDK transformer emits one outer `start`/`finish` for the run, and each step's `writer.write` becomes a `workflow-step-output` part).

### `run-sql-agent`

Streams `sqlAgent.fullStream` and forwards reasoning and the introspect/execute/data-gap **tool cards** to the UI, while:

- **Clarify suspend:** on a pending `clarify-request` call, it suppresses that call's chunks, shapes the questions with `generateClarification`, stashes replay context in step state, and `suspend({ questions })`. On resume it replays the buffered turn with the answers applied. See [Clarification flow](./clarification-flow.md).
- **Finalize handoff:** it suppresses the `finalize-sql-answer` call's chunks and captures the brief (the model-authored fields plus the rows captured from the last `execute-sql` result), returning it as the step output.
- **Prose buffering:** the SQL agent's own text chunks are buffered, not streamed — discarded once `finalize-sql-answer` arrives (the answer agent writes the reply), and flushed only in the fallback where the agent finished without finalizing.

### `run-answer-agent`

Streams `answerAgent.fullStream` to render the final user-facing reply from the structured brief, appending its text to the same message. When no brief was produced (the fallback), it passes the SQL agent's buffered text through as the workflow output. See [SQL agent and database tools](./sql-agent-tools.md).

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

Registered agents: `sqlAgent`, `answerAgent`, `businessKnowledgeAgent`. Registered workflows: `sqlWorkflow`. Snapshot storage (`@mastra/pg` `PostgresStore`) is attached only when `MASTRA_DATABASE_URL` is set (required for clarify resume).

A full turn's trace makes the split visible: `business-knowledge-agent` (fresh turns) → `sql-workflow` → `run-sql-agent` (SQL/database tools, optional `clarify-request` suspend → `clarify-agent` fallback drafting, optional `report-data-gap`, `finalize-sql-answer`) → `run-answer-agent`.

`app/api/chat/route.ts` schedules `flushMastraObservability()` in a Next.js `after()` callback so traces are flushed after the response is created.

## Requirements

- `/api/chat` must run on Node.js, not the Edge runtime, because PostgreSQL and Mastra tooling require Node APIs.
- The API must stream AI SDK v6 UI messages from the `sql-workflow`.
- Reasoning parts must be sent so the frontend can render chain-of-thought/tool progress.
- Trace metadata must include `userId` and should include `sessionId` when available.
- Business-knowledge selection runs before streaming on fresh turns (skipped on resume), bounded by a timeout combined with the request's abort signal, and must degrade to an empty block on failure/timeout/abort, never blocking the turn.
- Relative dates must resolve against the user's local `currentDate`, with a server UTC fallback.
- A resume request (`runId` + `resumeData`) must continue the suspended run rather than starting a fresh turn.
- Observability flushing must not block creation of the streaming response.

## Error handling

- Authentication failure inside the route returns 401 (`未登录`) before calling Mastra; normal proxy-routed signed-out HTTP requests are redirected before the route runs.
- Tool/model errors are expected to appear as stream errors or AI SDK error state on the frontend.
- The frontend displays `error.message || "出错了，请重试。"` above the composer.

## Manual verification

- Signed-out POST to `/api/chat` through normal app routing redirects to `/sign-in` with `redirect_url`.
- Route-handler invocation without `userId` returns 401.
- Signed-in chat request streams text/tool/reasoning parts, ending with the answer agent's reply as the final text.
- An ambiguous question suspends the run (clarification card); submitting resumes it with `runId`/`resumeData` and streams the final answer as a new assistant turn.
- Langfuse traces include Clerk `userId` and thread/session id when supplied, and show `business-knowledge-agent`, `sql-workflow`, `run-sql-agent`, and `run-answer-agent`.
- Stopping the frontend generation aborts the active workflow and downstream SQL/tool work.
