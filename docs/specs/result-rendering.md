# Result rendering spec

## Status

Implemented / current state.

## Goal

Render assistant responses, SQL tool calls, query result tables, and simple charts in a readable streaming chat UI.

## Relevant files

- `components/assistant-ui/thread.tsx`
- `components/assistant-ui/chain-of-thought.tsx`
- `components/assistant-ui/sql-tools.tsx`
- `components/assistant-ui/markdown-text.tsx`
- `components/assistant-ui/query-result.tsx`

## Message layout

Assistant messages are split into:

- collapsible chain-of-thought group containing reasoning and non-clarify tool calls
- clarify exchange (drafting spinner, choice form, or answered recap), rendered outside the chain-of-thought group
- final answer markdown
- action bar for copy/regenerate when final answer exists and is not streaming

On a clarify turn, reasoning/narration emitted **before** the clarify part is suppressed in both the asking and answered phases, so only discovery tool cards remain in the chain of thought (post-clarify thinking and the final answer still render).

User messages render as right-aligned bubbles. There is **no** synthetic clarification answer message: the user's clarify choice is shown inline within the same assistant turn as a right-aligned compact-chip recap (`ClarifyAnswerSummary`), driven by the clarify-request tool part's `output.answers`.

## Chain-of-thought rendering

`ChainOfThoughtGroup`:

- Shows `Working…` while streaming.
- Shows `Thought for Xs` after completion when duration was observed.
- Shows number of tool calls after completion.
- Auto-expands while running and auto-collapses shortly after completion unless the user toggles manually.

Tool calls render as timeline steps.

## SQL tool card rendering

`components/assistant-ui/sql-tools.tsx` provides dedicated renderers for:

- `executeSql`
- `introspectDatabase`
- `reportDataGap`
- `clarifyRequest` — rendered via `ClarifyExchange` directly by the thread, **not** through the `ToolPart` dispatcher, because it owns its own form/answer-summary (see [Clarification flow](./clarification-flow.md))

Tool names are normalized so kebab/camel/snake variants match.

### `executeSql` tool card

- Header preview is one-line SQL with simple syntax highlighting.
- Metadata shows row count after completion.
- Body shows full SQL in a preformatted block.
- Body shows raw tool rows in `SqlResultTable`.
- `SqlResultTable` caps visible preview rows at 10 and displays a `+N more rows` footer.

### `introspectDatabase` tool card

- Header preview is `introspectDatabase`.
- Metadata shows table count inferred from markdown headings.
- Body shows the schema markdown as preformatted text with max height and scrolling.

### `reportDataGap` tool card

- An execute tool, so it renders through the normal `ToolPart` dispatcher as a chain-of-thought timeline step (not pulled out like `clarifyRequest`); the user-facing acknowledgment itself lives in the agent's final answer markdown.
- Header preview is `数据局限：<requested>` (or `数据局限` before the request streams in).
- Metadata shows the gap category as a Chinese label (`缺少对应字段或表` / `缺少相关数据` / `数据粒度不足` / `超出数据库范围`).
- Body lists `缺少` (missing), `依据` (evidence), and `可改为回答` (available) when present.

### Unknown tools

Unknown tools render through `ToolFallback` with input/output/error JSON-ish dumps.

## Markdown rendering

`MarkdownText` uses `react-markdown` with `remark-gfm`.

Supported custom behavior:

- SQL-ish fenced code blocks (`sql`, `postgres`, `postgresql`) use `HighlightedSql`.
- Fenced code blocks have a header and copy button.
- Inline code is styled.
- GFM tables are intercepted by `TableRenderer`.

## Prose table rendering through `QueryResult`

When the assistant writes a parseable GFM table in its final answer:

1. `markdown-text.tsx` reads the table's HAST node.
2. It extracts header cells as column names.
3. It extracts body rows as `Record<string, string>[]`.
4. It renders `<QueryResult rows={rows} />`.

If the table cannot be parsed yet, for example mid-stream before body rows exist, the renderer falls back to a plain horizontally scrollable table.

Current live flow uses the model-written markdown table as the source for `QueryResult`; the `executeSql` tool output table remains a separate preview inside the collapsible tool card.

## `QueryResult` contract

```ts
type ChartKind = "line" | "bar";

type ChartSpec = {
  kind: ChartKind;
  x: string;
  y: string | string[];
};

type QueryResultProps = {
  rows: Record<string, unknown>[];
  chart?: ChartSpec;
  className?: string;
};
```

Current live markdown path does not supply `chart`; chart mapping is inferred.

## Table behavior

- Empty result: renders `0 rows returned`.
- All rows remain in the DOM; tables with more than 20 rows add a `scroll for more` count hint.
- Table is `w-full` inside a bordered scroll container.
- Container has max height `560px` and scrolls for long tables.
- Header is sticky.
- Numeric columns are right-aligned and use tabular numbers.
- Integer numeric labels are grouped with locale separators where safe.
- Nullish values render as `NULL` with muted italic styling.

## Numeric detection

A column is numeric when:

- at least one non-missing value parses to a finite number, and
- every non-missing value parses to a finite number.

Missing values include nullish, blank, or non-numeric placeholders without digits such as `—`, `N/A`, or `无数据`.

## Chart behavior

`QueryResult` can render:

- table
- line chart
- bar chart

Current chart implementation is dependency-free SVG.

Inference rules:

- Numeric columns are detected from rows.
- X column is the provided `chart.x`, otherwise the first non-numeric column, otherwise the first column.
- Y columns are provided `chart.y`, otherwise numeric columns except x.
- At most 5 series are plotted, matching `--chart-1` through `--chart-5`.
- If no y series exists, chart toggles are hidden and table mode is used.

Chart details:

- Uses ordinal/index-based x positioning.
- Bar charts include zero in the y-scale.
- Line charts create gaps for missing values.
- Hover guide and tooltip show row/series values.
- Multi-series charts show a legend.
- X labels are thinned to avoid overlap.

## Requirements

- Final answer markdown tables must not overflow the message column horizontally.
- Long final answer tables must remain readable with sticky headers and scrolling.
- The user must be able to toggle parseable numeric tables to line/bar charts when viable.
- Tool-output rows must remain visible in the chain-of-thought card but should stay capped to avoid noisy previews.

## Known limitations

- Charts use ordinal x-positioning, not a true time/linear x-scale.
- No stacked bars, pivoted series grouping, or downsampling.
- Numeric formatting may group ID-like integer columns.
- Parsing and resolving markdown tables happens during streaming; very large model-written tables may be expensive.
