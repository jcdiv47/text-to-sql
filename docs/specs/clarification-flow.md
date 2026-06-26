# Clarification flow spec

## Status

Implemented / current state.

## Goal

When a text-to-SQL request is ambiguous enough that SQL generation would require guessing, ask the user concise choice-based questions and continue the **same assistant turn** once the user answers — without a synthetic follow-up user message.

## Relevant files

- `mastra/agents/sql-agent.ts`
- `mastra/agents/clarify-agent.ts`
- `mastra/tools/clarify-request.ts`
- `components/assistant-ui/sql-tools.tsx`
- `components/assistant-ui/thread.tsx`
- `components/assistant-ui/chat-context.tsx`

## Design: a no-`execute` client-side tool

`clarify-request` is a **human-in-the-loop client tool**: it declares `inputSchema`/`outputSchema` but has **no `execute`**. The clarification round-trip therefore needs no server-side suspension and **no persistent storage**:

1. `sqlAgent` detects material ambiguities and (where possible) uses `execute-sql` discovery queries to obtain concrete candidate choices.
2. `sqlAgent` **drafts the clarification questions itself** and calls `clarify-request`, passing them as `questions` (each with explicit `choices` covering the discovered candidates).
3. Because the tool has no `execute`, the model's call parks in the `input-available` state and the **assistant turn ends** with the call pending. No server run is suspended.
4. The tool's `transform.display.input` shapes the payload that renders: it **validates and passes the model's `questions` through directly**, and only falls back to the clarify sub-agent (or a generic question) when the model didn't supply usable `questions`. The result rides on the tool part's transformed `input` and renders in the form.
5. The frontend renders the questions as an interactive form.
6. The user submits choices. The form calls `addToolResult({ tool, toolCallId, output: { answers } })`, supplying the choice as the **clarify-request tool result**.
7. `useChat` is configured with `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`, so supplying the result **resumes the same assistant message**. The agent reads the structured answers and writes/executes the final SQL into the same turn.

> **Why the model drafts the questions:** empirically the SQL agent reliably produces high-quality, SQL-relevant questions once it has run discovery (e.g. one question listing all eight discovered "嘉里中心" malls with their cities). An earlier design routed the model's input through the sub-agent unconditionally, but the model passes its drafted `questions` — not the `ambiguities` the sub-agent expected — so the sub-agent received no usable input and emitted the **generic fallback** question. The transform now uses the model's `questions` directly.

### Display-transform key

The transform is registered under the key **`input`** — the name of the transformer that shapes the displayed input — **not** `input-available` (the tool phase). Core runs it and stores the result under the `input-available` phase; the AI SDK reads it from there. Using the phase name as the registration key yields a `{ message: "…payload unavailable" }` placeholder instead of the questions.

### Transform context tradeoff (fallback path only)

The `transform.display.input` context exposes neither `abortSignal` nor `requestContext` (the pattern an `execute` would have forwarded into a sub-agent call). When the **fallback** sub-agent runs (model omitted `questions`), hitting **stop** during the "preparing…" window won't cancel it and its spans lose explicit user/session metadata (they still nest under the parent run via ambient context). Accepted: the fallback rarely runs, and clarify is self-contained. The primary path makes no sub-agent call at all, so it has neither cost.

### Why not Mastra native approval / suspend

Both native approval and suspend/resume **require persistent storage** (`resumeStream` throws `AGENT_RESUME_NO_SNAPSHOT_FOUND` without it), and native **approval cannot carry a structured answer back** to the agent (the `{ approved }` resume schema strips extra fields like `reason`). The no-`execute` client tool sidesteps both. Verified via mock-model prototypes.

## Refresh behavior

Refresh on the final answer is a plain `regenerate({ messageId })`, which re-runs the **whole turn** — including re-asking clarify. This is an accepted tradeoff: the turn is not resumable from the post-clarify point without storage.

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

Because the tool has no `execute`, the transform receives the **raw** model args (not parsed by `inputSchema`), so `generateClarification` re-validates `questions` itself with the clarify question schema.

Current input tolerance:

- The question `type` and the structured-ambiguity `selection` (the single/multiple choice mode) are trimmed and lowercased.
- Any value starting with `single` normalizes to `single`; any value starting with `multi` normalizes to `multiple` (e.g. `Single`, `single-choice`, `Multiple`, `multi_choice`, `multiselect`).
- If the model's `questions` fail validation (e.g. a `type` outside `single`/`multi*`, or a question with fewer than 2 or more than 12 choices), the transform drops to the fallback path.
- Unknown structured-ambiguity category `type` values (`entity`, `category`, `metric`, …) are caught as `entity`.
- Up to 3 questions (and up to 3 structured ambiguities) are accepted; each question/ambiguity must have 2-12 choices/candidates.

## `clarify-request` output contract

The output is the **user's resolved choices**, supplied by the form via `addToolResult` (not produced by the tool itself):

```ts
{
  answers: { question: string; answer: string }[]; // one entry per question, in order
}
```

The drafted questions live on the tool part's display-transformed `input.questions`, so the form has both the questions (from `input`) and, once answered, the choices (from `output`).

Resolution order inside the display transform's `generateClarification` (which never throws — the form always shows):

1. **Model `questions`** that validate → rendered directly (capped to 3). This is the normal path.
2. Otherwise the clarify **sub-agent** drafts questions from `request`/`ambiguities`/`ambiguity`/`context` (structured output, capped to 3).
3. If the sub-agent generation fails or returns nothing usable → a **generic fallback** single-choice question (use the request as written / provide more detail).

## Frontend rendering

`components/assistant-ui/sql-tools.tsx` detects clarify tool parts by normalizing names so both `clarify-request` and `clarifyRequest` match. `ClarifyExchange` selects the phase from the tool part's state, so it is safe to render on any message (including after a reload):

- **drafting** (`input-streaming`, or `input-available` before the sub-agent's questions land) → a compact `正在准备追问问题…` spinner.
- **asking** (`input-available` with questions) → the interactive choice form (`需要你确认`).
- **answered** (`output-available` / `output-error`) → a read-only recap of the choice as compact chips.

Form behavior:

- Each question shows whether it is single-choice or multi-choice.
- Single-choice selections replace the previous selection; multi-choice selections toggle each option.
- Every question also offers an injected **`其他（自行输入）` free-text option**, tracked in separate form state from the model choices (so a model-controlled choice id can never collide with it). Selecting it requires typing a value before the form can submit.
- Submit is enabled only when every question is answered (a selection exists, and any "Other" selection has non-empty text), and is disabled after local submission or while the assistant is running.

On submit, the form builds one answer entry per question and calls `submitClarification({ tool, toolCallId, answers })` (a thin wrapper over `addToolResult`, bridged through `chat-context.tsx`). For each question:

- predefined picks contribute their **labels**;
- an "Other" pick contributes the typed text as `其他：<text>`, so the agent can tell the answer was off-menu;
- multiple picks are joined with `、`.

## Thread integration

`thread.tsx` treats an unanswered clarify ask on the latest assistant message as a pause state:

- `awaitingClarify` is true when the last message is an assistant message with a clarify part in `input-available`; the composer is disabled until the form is submitted.
- Narration emitted **before** the clarify part (the model's pre-clarify reasoning/text) is suppressed in both the asking and answered phases — only discovery tool cards stay in the chain of thought, and post-clarify thinking plus the final answer render normally. (Suppression is keyed on the clarify part's index, which is `-1` on normal turns, so non-clarify turns are unaffected.)
- The clarify form is pulled out of the chain-of-thought group and rendered as its own form/summary by `ClarifyExchange`.

## Requirements

- Clarification is choice-based, plus a single per-question free-text "Other" escape hatch.
- The agent must not generate final SQL until blocking ambiguities are answered.
- The UI must prevent sending arbitrary new composer messages while a clarification is active.
- The clarification round-trip must require no server-side storage.

## Known limitations

- Submitted clarification answers carry labels (and any free-text), not stable choice IDs.
- Form state is local React state; if the page reloads before submission, selections reset (the form re-renders from the tool part, but unsaved selections are lost).
- Refresh on the final answer re-runs the whole turn and re-asks clarify; the post-clarify point is not independently resumable.
- On the **fallback** path only, the clarify sub-agent generation in the display transform cannot be cancelled by stop and loses explicit tracing metadata (see [Transform context tradeoff (fallback path only)](#transform-context-tradeoff-fallback-path-only)).
- Model-drafted `questions` are rendered directly with light validation (type/choice-count); the tool does not re-check that choice labels correspond to real schema values.
