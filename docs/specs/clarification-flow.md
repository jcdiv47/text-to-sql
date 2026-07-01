# Clarification flow spec

## Status

Implemented / current state.

## Goal

When a text-to-SQL request is ambiguous enough that SQL generation would require guessing, ask the user concise choice-based questions, **pause the run**, and continue the same logical turn once the user answers — using native Mastra **workflow suspend/resume**.

## Relevant files

- `mastra/workflows/sql-workflow.ts` (the suspend/resume owner)
- `mastra/agents/sql-agent.ts`
- `mastra/agents/clarify-agent.ts`
- `mastra/tools/clarify-request.ts`
- `mastra/index.ts` (workflow snapshot storage)
- `app/api/chat/route.ts` (fresh vs. resume request handling)
- `lib/chat-registry.ts` (transport: maps resume → `runId`/`resumeData`)
- `components/assistant-ui/sql-tools.tsx`
- `components/assistant-ui/thread.tsx`
- `components/assistant-ui/chat-context.tsx`

## Design: a no-`execute` tool bridged to a workflow suspend

`clarify-request` is a **human-in-the-loop tool with no `execute`**. On its own that only ends the agent turn with the call pending; it does **not** pause a server run. The `sql-workflow` step wraps the agent and turns that pending call into a real workflow **suspend**, so the run can be resumed later from a snapshot (this is the "Bridge" design):

1. `sqlAgent` detects material ambiguities and (where possible) uses `execute-sql` discovery queries to obtain concrete candidate choices.
2. `sqlAgent` **drafts the clarification questions itself** and calls `clarify-request`, passing them as `questions` (each with explicit `choices` covering the discovered candidates).
3. Because the tool has no `execute`, the model's call parks in the `input-available` state and the **agent turn ends** with the call pending.
4. The `run-sql-agent` **workflow step** (in `sql-workflow.ts`), which is streaming `sqlAgent.fullStream`, detects that pending clarify `tool-call`, **suppresses every chunk for that call** from the UI stream (the form renders from the suspend payload, not a tool card), and shapes the questions with `generateClarification` (exported from `clarify-request.ts`).
5. The step stashes the replay context in step **state** (`setState({ replayMessages: agentStream.response.uiMessages, clarifyToolCallId, businessKnowledge })`) and then calls the step's own `suspend({ questions })`. Mastra persists the run snapshot (see [Snapshot storage](#snapshot-storage)).
6. The suspend surfaces to the client as a `data-workflow` UI part with `status: "suspended"`; the part `id` is the **workflow run id**, and the questions ride the suspended step's `suspendPayload`.
7. The frontend renders the questions as an interactive form (`WorkflowClarifyForm`), keyed by that run id.
8. The user submits choices. The form calls `resumeClarification({ runId, answers })`, which sends a resume request carrying `{ runId, resumeData: { answers } }` (the user's confirmed choices appear as a **new user turn**).
9. The workflow **resumes** the same run: the step rebuilds the buffered assistant turn with the answers attached — it marks the buffered clarify part `output-available` with `{ answers }` (`applyClarifyAnswers` + `mergeById`) — and re-runs `sqlAgent`, which now sees a completed clarify exchange and continues to discovery/SQL. A second clarification simply suspends again.

> **Why the model drafts the questions:** empirically the SQL agent reliably produces high-quality, SQL-relevant questions once it has run discovery (e.g. one question listing all eight discovered "嘉里中心" malls with their cities). The step passes the model's `questions` straight to `generateClarification`, which renders them directly and only falls back to the sub-agent when they are missing/invalid.

## Why native suspend, and why a workflow step

An earlier design kept clarify entirely client-side (the no-`execute` tool result supplied via `addToolResult`, with `useChat` configured to auto-resume the same assistant message). That was replaced by native workflow suspend/resume.

- **Why a workflow step owns the suspend (not a tool/agent suspend):** an agent-internal tool suspend does **not** propagate to the workflow run (`createStepFromAgent` doesn't forward it; matches `mastra-ai/mastra#11283`), so the workflow-level `suspend()` must be the **step's own**. The step therefore detects the pending clarify call and suspends itself.
- **`sendAutomaticallyWhen` is removed and must not be re-added.** In the new flow a suspend turn's tool calls are all complete (the clarify call is suppressed, not left pending on the client), so `lastAssistantMessageIsCompleteWithToolCalls` would spuriously auto-send a fresh run.
- **UX consequence:** the clarification is a separate card, the user's answer is its own user turn, and the final answer streams as a **new assistant turn** — the round-trip no longer folds into one assistant message.

## Snapshot storage

Suspend/resume **requires persistent storage** (`resumeStream` throws `AGENT_RESUME_NO_SNAPSHOT_FOUND` without it). `mastra/index.ts` wires a `@mastra/pg` `PostgresStore` keyed on `MASTRA_DATABASE_URL`:

- It is attached only when `MASTRA_DATABASE_URL` is set, so the app still boots without it (in-memory fallback, non-durable — a resume only survives within one running process).
- Use a **separate** Postgres database from `DATABASE_URL`; Mastra creates and owns its own tables.
- Durable/serverless resume (surviving a redeploy or a different worker) needs `MASTRA_DATABASE_URL`.

## Fresh vs. resume at the route

`app/api/chat/route.ts` distinguishes the two request shapes (see [API streaming and observability](./api-streaming-observability.md)):

- **Fresh turn:** `inputData: { messages, trigger }` starts the workflow over the chat history.
- **Resume:** `runId` + `resumeData` continues the suspended run from its snapshot. Business-knowledge selection is **skipped** on resume (the original turn's grounding is re-applied from step state).

## Refresh behavior

Refresh on the final answer is a plain `regenerate({ messageId })`, which re-runs the **whole turn** — including re-asking clarify. The post-clarify point is not independently resumable via regenerate; resuming is only reached through the suspended run's `runId`.

## Clarify agent configuration

`clarifyAgent` is the **fallback** drafter only (used when the model doesn't pass `questions`):

- `id`: `clarify-agent`
- `name`: `Clarify Agent`
- model: `openrouter/moonshotai/kimi-k2.6`
- `temperature`: 0
- `maxSteps`: 3
- OpenRouter provider sort: `throughput`
- no tools

It must return structured data matching:

```ts
type ClarificationOutput = {
  needsClarification: boolean;
  questions: {
    id: string;
    type: "single" | "multiple";
    question: string;
    choices: {
      id: string;
      label: string;
      description?: string;
    }[];
  }[];
};
```

## `clarify-request` input contract

The **primary** field is `questions` (drafted by the model). `request`/`ambiguities`/`ambiguity`/`context` are an optional fallback the sub-agent can draft from when the model doesn't provide `questions`.

```ts
{
  // Primary: the model's drafted questions, rendered directly.
  questions?: {
    id: string;
    type: "single" | "multiple";
    question: string;
    choices: { id: string; label: string; description?: string }[]; // 2-12
  }[]; // 1-3
  // Fallback inputs (sub-agent drafts questions from these):
  request?: string;
  ambiguities?: {
    id: string;
    type: "entity" | "category" | "metric" | "time_range" | "grouping" | "filter" | "limit";
    question: string;
    selection: "single" | "multiple";
    candidates: { id?: string; label: string; description?: string }[];
  }[];
  ambiguity?: string;
  context?: string;
}
```

`generateClarification` re-validates `questions` itself with the clarify question schema, because the workflow step passes it the **raw** model args.

Current input tolerance:

- The question `type` and the structured-ambiguity `selection` (the single/multiple choice mode) are trimmed and lowercased.
- Any value starting with `single` normalizes to `single`; any value starting with `multi` normalizes to `multiple` (e.g. `Single`, `single-choice`, `Multiple`, `multi_choice`, `multiselect`).
- If the model's `questions` fail validation (e.g. a `type` outside `single`/`multi*`, or a question with fewer than 2 or more than 12 choices), it drops to the fallback path.
- Unknown structured-ambiguity category `type` values (`entity`, `category`, `metric`, …) are caught as `entity`.
- Up to 3 questions (and up to 3 structured ambiguities) are accepted; each question/ambiguity must have 2-12 choices/candidates.

### `generateClarification` resolution order (never throws)

1. **Model `questions`** that validate → used directly (capped to 3). This is the normal path — no sub-agent call.
2. Otherwise the clarify **sub-agent** drafts questions from `request`/`ambiguities`/`ambiguity`/`context` (structured output, capped to 3).
3. If the sub-agent generation fails or returns nothing usable → a **generic fallback** single-choice question (use the request as written / provide more detail).

The step calls `generateClarification` directly (not via the tool's display transform). On the **fallback** sub-agent path it is invoked without an `abortSignal` or explicit tracing `requestContext`, so a fallback draft can't be cancelled by stop and its spans lose explicit user/session metadata (they still nest under the parent run). Accepted: the fallback rarely runs, and the primary path makes no sub-agent call at all.

## Answer / resume payload contract

The client resumes with the user's resolved choices:

```ts
{
  answers: { question: string; answer: string }[]; // one entry per question, in order
}
```

The step applies these to the buffered clarify tool part (`output-available` with `{ answers }`) so the replayed agent sees a completed exchange. The drafted questions live on the suspended step's `suspendPayload.questions`, which is what the form renders.

## Frontend rendering

### New flow (workflow suspend)

- `getSuspendedClarify(part)` (`sql-tools.tsx`) reads a pending clarification out of a `data-workflow` part whose `status` is `suspended`: the part `id` is the run id, and the questions come from the suspended step's `suspendPayload.questions`.
- `WorkflowClarifyForm({ runId, questions })` renders `ClarifyForm`; on submit it calls `resumeClarification({ runId, answers })` (from `useChatActions`, bridged through `chat-context.tsx`).
- `resumeClarification` (`thread.tsx`) builds a short summary of the choices and calls `sendMessage({ text: summary }, { body: { resume: { runId, answers } } })`, so the answer appears as a **user turn**; `chat-registry.ts` maps that body to `{ runId, resumeData: { answers } }`.
- The suspended form renders on the **most recent assistant message** and reappears for retry if a resume failed (its user turn was appended but no assistant response followed), yet hides once a resume turn produces a response.

### Legacy flow (pre-migration threads)

Threads persisted before the migration may still contain a **`clarify-request` tool part**. New clarifications never produce a tool part, so such parts are rendered **read-only**:

- `isClarifyToolPart(part)` matches both `clarify-request` and `clarifyRequest`.
- `ClarifyExchange` renders the tool part: `ClarifyAnswerSummary` (compact chips) when answered, otherwise `LegacyClarifyReadOnly` — a read-only view that cannot resume. To re-run such a clarification, ask again.

### `ClarifyForm` behavior (both flows)

- Each question shows whether it is single-choice or multi-choice.
- Single-choice selections replace the previous selection; multi-choice selections toggle each option.
- Every question also offers an injected **`其他（自行输入）` free-text option**, tracked in separate form state from the model choices (so a model-controlled choice id can never collide with it). Selecting it requires typing a value before the form can submit.
- Submit is enabled only when every question is answered (a selection exists, and any "Other" selection has non-empty text), and is disabled while the assistant is running.

On submit, the form builds one answer entry per question:

- predefined picks contribute their **labels**;
- an "Other" pick contributes the typed text as `其他：<text>`, so the agent can tell the answer was off-menu;
- multiple picks are joined with `、`.

## Thread integration

`thread.tsx` treats a suspended clarify on the latest assistant turn as a pause state:

- `awaitingClarify` is true when the last message is an assistant message with a part for which `getSuspendedClarify` returns a suspended run; the composer is disabled until the form is submitted.
- The clarify form is pulled out of the chain-of-thought group and rendered as its own form/summary.

## Requirements

- Clarification is choice-based, plus a single per-question free-text "Other" escape hatch.
- The agent must not generate final SQL until blocking ambiguities are answered.
- The UI must prevent sending arbitrary new composer messages while a clarification is active.
- Suspend/resume requires Mastra snapshot storage; durable resume requires `MASTRA_DATABASE_URL` (a separate Postgres database).

## Known limitations

- Submitted clarification answers carry labels (and any free-text), not stable choice IDs.
- Form state is local React state; if the page reloads before submission, selections reset (the form re-renders from the suspended run, but unsaved selections are lost).
- Without `MASTRA_DATABASE_URL`, snapshots live in memory only and a resume won't survive a redeploy or a different serverless worker.
- Refresh on the final answer re-runs the whole turn and re-asks clarify; the post-clarify point is not independently resumable via regenerate.
- On the **fallback** path only, the clarify sub-agent generation cannot be cancelled by stop and loses explicit tracing metadata.
- Pre-migration `clarify-request` tool parts render read-only and cannot be resumed; re-ask to clarify again.
- Model-drafted `questions` are rendered with light validation (type/choice-count); the tool does not re-check that choice labels correspond to real schema values.
