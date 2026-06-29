"use client";

import { useMemo, useState, type FC, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  HelpCircleIcon,
  LoaderIcon,
  TableIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChainOfThoughtStep } from "@/components/assistant-ui/chain-of-thought";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { useChatActions } from "@/components/assistant-ui/chat-context";

const ANIMATION_DURATION = 200;

/* ------------------------------------------------------------------ */
/* AI SDK tool part helpers                                            */
/* ------------------------------------------------------------------ */

export type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;
type ToolState = ToolUIPart["state"];

/** Normalizes a tool name so kebab (`clarify-request`) and camel (`clarifyRequest`) match. */
const normalizeToolName = (name: string) => name.replace(/[-_]/g, "").toLowerCase();

const toolIsRunning = (state: ToolState) =>
  state === "input-streaming" || state === "input-available";

type ToolCardProps = {
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const toToolCardProps = (part: AnyToolUIPart): ToolCardProps => {
  const p = part as { state: ToolState; input?: unknown; output?: unknown; errorText?: string };
  return { state: p.state, input: p.input, output: p.output, errorText: p.errorText };
};

export const isClarifyToolPart = (part: AnyToolUIPart): boolean =>
  normalizeToolName(getToolName(part)) === "clarifyrequest";

/**
 * True when a clarify call is paused awaiting the user's choice. clarify-request
 * is a client-side (no-execute) tool, so it parks in `input-available` with no
 * output until the form supplies its result.
 */
export const isClarifyAskPart = (part: AnyToolUIPart): boolean =>
  isClarifyToolPart(part) && (part as { state: ToolState }).state === "input-available";

/* ------------------------------------------------------------------ */
/* SQL syntax highlighting                                              */
/* ------------------------------------------------------------------ */

const KW_RE =
  /^(SELECT|FROM|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|WHERE|AND|OR|NOT|AS|ILIKE|LIKE|IN|IS|NULL|GROUP|BY|ORDER|LIMIT|OFFSET|HAVING|DISTINCT|CASE|WHEN|THEN|ELSE|END|UNION|ALL|EXISTS|BETWEEN|ASC|DESC|WITH)$/i;
const FN_RE =
  /^(COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|ROUND|DATE_TRUNC|EXTRACT|LOWER|UPPER|LENGTH|CAST|NOW)$/i;

type SqlTokenKind = "kw" | "fn" | "str" | "num" | "punct" | "text";

const TOKEN_CLASS: Record<SqlTokenKind, string> = {
  text: "text-foreground/90",
  kw: "text-[oklch(0.46_0.13_295)] dark:text-[oklch(0.74_0.11_295)]",
  fn: "text-[oklch(0.46_0.1_230)] dark:text-[oklch(0.76_0.09_230)]",
  str: "text-[oklch(0.46_0.1_150)] dark:text-[oklch(0.78_0.09_150)]",
  num: "text-[oklch(0.5_0.12_70)] dark:text-[oklch(0.8_0.1_70)]",
  punct: "text-muted-foreground",
};

function tokenizeSql(sql: string): { value: string; kind: SqlTokenKind }[] {
  const out: { value: string; kind: SqlTokenKind }[] = [];
  const re = /('[^']*'?)|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_']+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const value = m[0];
    let kind: SqlTokenKind = "text";
    if (m[1]) kind = "str";
    else if (m[2]) kind = "num";
    else if (m[3]) {
      if (KW_RE.test(value)) kind = "kw";
      else if (FN_RE.test(value)) kind = "fn";
    } else if (m[5]) kind = "punct";
    out.push({ value, kind });
  }
  return out;
}

/**
 * Inline SQL syntax highlighting. Also used by markdown-text.tsx to highlight
 * ```sql fenced code blocks in assistant messages.
 */
export const HighlightedSql: FC<{ sql: string; className?: string }> = ({ sql, className }) => {
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
  return (
    <span className={className}>
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_CLASS[t.kind]}>
          {t.value}
        </span>
      ))}
    </span>
  );
};

/** Reads the `query` arg from the tool input (partial object while streaming). */
function extractQuery(input: unknown): string {
  const query = (input as { query?: unknown } | undefined)?.query;
  return typeof query === "string" ? query : "";
}

/* ------------------------------------------------------------------ */
/* Timeline tool card shell                                             */
/* ------------------------------------------------------------------ */

const ToolMarkerIcon: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="border-border/80 bg-muted/40 text-muted-foreground mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border [&_svg]:size-3">
    {children}
  </div>
);

type TimelineToolCardProps = {
  state: ToolState;
  /** mono one-line preview shown in the collapsed header */
  preview: ReactNode;
  /** right-aligned mono metadata, e.g. "1 row" — hidden while running */
  meta?: string;
  children: ReactNode;
};

/**
 * The collapsible card body of a tool step. Spinner + shimmering "Running…"
 * while the tool executes; check / error icon + metadata once settled.
 * The error message itself is rendered by callers via {@link ToolError}.
 */
const TimelineToolCard: FC<TimelineToolCardProps> = ({ state, preview, meta, children }) => {
  const running = toolIsRunning(state);
  const isError = state === "output-error";

  return (
    <Collapsible
      data-slot="sql-tool-root"
      className="aui-sql-tool-root border-border/80 bg-muted/20 w-full overflow-hidden rounded-[10px] border"
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
    >
      <CollapsibleTrigger
        data-slot="sql-tool-trigger"
        className="aui-sql-tool-trigger group/trigger hover:bg-muted/40 flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors"
      >
        {running ? (
          <LoaderIcon
            className="text-muted-foreground size-3.5 shrink-0 animate-spin"
            aria-hidden
          />
        ) : isError ? (
          <XCircleIcon className="text-destructive size-3.5 shrink-0" aria-hidden />
        ) : (
          <CheckIcon
            className="size-3.5 shrink-0 text-[oklch(0.55_0.15_162)] dark:text-[oklch(0.7_0.17_162)]"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{preview}</span>
        {running ? (
          <span className="relative shrink-0 text-[11px] font-medium">
            <span className="text-muted-foreground">运行中…</span>
            <span
              aria-hidden
              className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
            >
              运行中…
            </span>
          </span>
        ) : meta ? (
          <span className="text-muted-foreground shrink-0 font-mono text-[11px]">{meta}</span>
        ) : null}
        <ChevronDownIcon
          className={cn(
            "text-muted-foreground size-4 shrink-0",
            "transition-transform duration-(--animation-duration) ease-out",
            "group-data-[state=closed]/trigger:-rotate-90",
            "group-data-[state=open]/trigger:rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        data-slot="sql-tool-content"
        className={cn(
          "aui-sql-tool-content relative overflow-hidden outline-none",
          "group/collapsible-content ease-out",
          "data-[state=closed]:animate-collapsible-up",
          "data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:fill-mode-forwards",
          "data-[state=closed]:pointer-events-none",
          "data-[state=open]:duration-(--animation-duration)",
          "data-[state=closed]:duration-(--animation-duration)",
        )}
      >
        <div className="border-border/60 border-t px-3 pt-2.5 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const ToolError: FC<{ state: ToolState; errorText?: string }> = ({ state, errorText }) => {
  if (state !== "output-error" || !errorText) return null;
  return <p className="text-destructive mb-2 text-xs">{errorText}</p>;
};

/* ------------------------------------------------------------------ */
/* executeSql                                                           */
/* ------------------------------------------------------------------ */

type ExecuteSqlResult = { rows?: Record<string, unknown>[]; rowCount?: number };

const MAX_PREVIEW_ROWS = 10;

function formatCell(value: unknown): { text: string; isNull: boolean } {
  if (value == null) return { text: "NULL", isNull: true };
  if (typeof value === "object") return { text: JSON.stringify(value), isNull: false };
  return { text: String(value), isNull: false };
}

const SqlResultTable: FC<{ rows: Record<string, unknown>[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-muted-foreground mt-2.5 text-xs">返回 0 行</p>;
  }
  const columns = Object.keys(rows[0] ?? {});
  const visible = rows.slice(0, MAX_PREVIEW_ROWS);
  const hidden = rows.length - visible.length;

  return (
    <div className="border-border/80 mt-2.5 inline-block max-w-full overflow-x-auto rounded-lg border">
      <table className="border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="bg-muted/40 border-border/80 text-muted-foreground border-b px-3.5 py-1.5 text-start font-mono text-[10px] font-medium tracking-[0.1em] uppercase"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => (
            <tr key={ri} className="border-border/40 border-b last:border-b-0">
              {columns.map((col) => {
                const cell = formatCell(row[col]);
                return (
                  <td
                    key={col}
                    className={cn(
                      "px-3.5 py-1.5 font-mono text-xs whitespace-nowrap",
                      cell.isNull && "text-muted-foreground/60 italic",
                    )}
                  >
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <div className="border-border/60 text-muted-foreground border-t px-3.5 py-1.5 font-mono text-[11px]">
          另有 {hidden} 行
        </div>
      )}
    </div>
  );
};

const ExecuteSqlTool: FC<ToolCardProps> = ({ state, input, output, errorText }) => {
  const query = extractQuery(input);
  const flat = query.replace(/\s+/g, " ").trim();
  const result = output as ExecuteSqlResult | undefined;
  const rowCount = result?.rowCount ?? result?.rows?.length;
  const meta = rowCount !== undefined ? `${rowCount} 行` : undefined;

  return (
    <ChainOfThoughtStep
      icon={
        <ToolMarkerIcon>
          <DatabaseIcon />
        </ToolMarkerIcon>
      }
    >
      <TimelineToolCard
        state={state}
        meta={meta}
        preview={flat ? <HighlightedSql sql={flat} /> : "执行 SQL"}
      >
        <ToolError state={state} errorText={errorText} />
        {query && (
          <pre className="bg-background/60 border-border/60 overflow-x-auto rounded-lg border px-3.5 py-2.5 font-mono text-xs leading-[1.8] whitespace-pre-wrap">
            <HighlightedSql sql={query} />
          </pre>
        )}
        {result?.rows && <SqlResultTable rows={result.rows} />}
      </TimelineToolCard>
    </ChainOfThoughtStep>
  );
};

/* ------------------------------------------------------------------ */
/* introspectDatabase                                                   */
/* ------------------------------------------------------------------ */

const IntrospectDatabaseTool: FC<ToolCardProps> = ({ state, output, errorText }) => {
  const schema = (output as { schema?: string } | undefined)?.schema;
  const tableCount = schema ? (schema.match(/(^|\n)## /g) ?? []).length : undefined;
  const meta = tableCount !== undefined ? `${tableCount} 张表` : undefined;

  return (
    <ChainOfThoughtStep
      icon={
        <ToolMarkerIcon>
          <TableIcon />
        </ToolMarkerIcon>
      }
    >
      <TimelineToolCard state={state} meta={meta} preview="读取数据库结构">
        <ToolError state={state} errorText={errorText} />
        {schema ? (
          <pre className="bg-background/60 border-border/60 max-h-64 overflow-auto rounded-lg border px-3.5 py-2.5 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap">
            {schema}
          </pre>
        ) : (
          <p className="text-muted-foreground text-xs">正在读取表结构…</p>
        )}
      </TimelineToolCard>
    </ChainOfThoughtStep>
  );
};

/* ------------------------------------------------------------------ */
/* reportDataGap                                                        */
/* ------------------------------------------------------------------ */

const DATA_GAP_CATEGORY_LABEL: Record<string, string> = {
  schema_gap: "缺少对应字段或表",
  data_gap: "缺少相关数据",
  granularity_gap: "数据粒度不足",
  out_of_scope: "超出数据库范围",
};

type DataGapData = {
  category?: string;
  requested?: string;
  missing?: string;
  evidence?: string;
  available?: string;
};

/**
 * Renders a report-data-gap step: the agent's structured "this can't be answered
 * from the database" signal. Unlike clarify-request it's an execute tool, so it
 * flows through the normal timeline as a chain-of-thought card; the user-facing
 * acknowledgment itself lives in the agent's final reply. `evidence` rides the
 * tool-call input; the output echoes the rest.
 */
const ReportDataGapTool: FC<ToolCardProps> = ({ state, input, output, errorText }) => {
  const data: DataGapData = { ...(input as DataGapData), ...(output as DataGapData) };
  const categoryLabel = data.category
    ? (DATA_GAP_CATEGORY_LABEL[data.category] ?? data.category)
    : undefined;

  return (
    <ChainOfThoughtStep
      icon={
        <ToolMarkerIcon>
          <TriangleAlertIcon />
        </ToolMarkerIcon>
      }
    >
      <TimelineToolCard
        state={state}
        meta={categoryLabel}
        preview={data.requested ? `数据局限：${data.requested}` : "数据局限"}
      >
        <ToolError state={state} errorText={errorText} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {data.missing && (
            <>
              <dt className="text-muted-foreground shrink-0">缺少</dt>
              <dd className="min-w-0">{data.missing}</dd>
            </>
          )}
          {data.evidence && (
            <>
              <dt className="text-muted-foreground shrink-0">依据</dt>
              <dd className="text-muted-foreground min-w-0">{data.evidence}</dd>
            </>
          )}
          {data.available && (
            <>
              <dt className="text-muted-foreground shrink-0">可改为回答</dt>
              <dd className="min-w-0">{data.available}</dd>
            </>
          )}
        </dl>
      </TimelineToolCard>
    </ChainOfThoughtStep>
  );
};

/* ------------------------------------------------------------------ */
/* clarifyRequest                                                       */
/* ------------------------------------------------------------------ */

export type ClarifyChoice = { id: string; label: string; description?: string };
export type ClarifyQuestion = {
  id: string;
  // The clarify tool normalizes the agent's type to single/multiple upstream,
  // so the form only ever receives these two values.
  type: "single" | "multiple";
  question: string;
  choices: ClarifyChoice[];
};

const isMultiClarifyQuestion = (type: ClarifyQuestion["type"]) => type === "multiple";

type ClarifyAnswerEntry = { question: string; answer: string };

/**
 * Renders the clarify exchange for one clarify-request tool part. clarify-request
 * is a client-side (no-execute) tool, so it moves through three visible phases:
 *   - drafting questions (input streaming) → a compact "preparing…" spinner;
 *   - `input-available` with questions → the interactive choice form;
 *   - answered (`output-available`) → a read-only summary of the choice.
 * The questions live on the tool part's (display-transformed) `input`, and the
 * chosen answers on its `output` once the form supplies the tool result.
 */
export const ClarifyExchange: FC<{ part: AnyToolUIPart }> = ({ part }) => {
  const state = (part as { state: ToolState }).state;
  const questions = (part as { input?: { questions?: ClarifyQuestion[] } }).input?.questions ?? [];
  const answers = (part as { output?: { answers?: ClarifyAnswerEntry[] } }).output?.answers;

  if (state === "output-available" || state === "output-error") {
    return answers && answers.length > 0 ? <ClarifyAnswerSummary answers={answers} /> : null;
  }

  if (state === "input-available" && questions.length > 0) {
    return (
      <ClarifyForm
        tool={getToolName(part)}
        toolCallId={(part as { toolCallId: string }).toolCallId}
        questions={questions}
      />
    );
  }

  // input-streaming, or input-available before the sub-agent's questions land.
  return (
    <div className="text-muted-foreground my-2 flex items-center gap-2 text-sm">
      <LoaderIcon className="size-4 shrink-0 animate-spin" aria-hidden />
      <span>正在准备追问问题…</span>
    </div>
  );
};

const ClarifyForm: FC<{ tool: string; toolCallId: string; questions: ClarifyQuestion[] }> = ({
  tool,
  toolCallId,
  questions,
}) => {
  const { submitClarification, isRunning } = useChatActions();
  // Model-choice picks and the injected free-text "Other" option are tracked in
  // separate state, so a model choice id (model-controlled and unconstrained —
  // often arbitrary Unicode) can never be mistaken for an "Other" sentinel.
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Single-choice: a model pick and the "Other" pick are mutually exclusive.
  const toggle = (q: ClarifyQuestion, choiceId: string) => {
    if (!isMultiClarifyQuestion(q.type)) {
      setAnswers((prev) => ({ ...prev, [q.id]: [choiceId] }));
      setOtherSelected((prev) => ({ ...prev, [q.id]: false }));
      return;
    }
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      return {
        ...prev,
        [q.id]: cur.includes(choiceId) ? cur.filter((c) => c !== choiceId) : [...cur, choiceId],
      };
    });
  };

  const toggleOther = (q: ClarifyQuestion) => {
    const next = !(otherSelected[q.id] ?? false);
    setOtherSelected((prev) => ({ ...prev, [q.id]: next }));
    if (next && !isMultiClarifyQuestion(q.type)) {
      setAnswers((prev) => ({ ...prev, [q.id]: [] }));
    }
  };

  // A question is answered once it has a model pick or the "Other" option — and
  // if "Other" is picked, the free-text field must be filled.
  const isAnswered = (q: ClarifyQuestion) => {
    const hasChoice = (answers[q.id] ?? []).length > 0;
    const other = otherSelected[q.id] ?? false;
    if (!hasChoice && !other) return false;
    if (other && (otherText[q.id] ?? "").trim() === "") return false;
    return true;
  };
  const allAnswered = questions.length > 0 && questions.every(isAnswered);

  const submit = () => {
    if (submitted || !allAnswered) return;
    setSubmitted(true);
    // Supply the choices as the clarify-request tool result. One entry per
    // question (in order); predefined picks become their labels, and an "Other"
    // pick contributes the typed text as "其他：<text>" so the agent can tell the
    // answer was off-menu.
    const responses = questions.map((q) => {
      const parts = (answers[q.id] ?? []).map(
        (id) => q.choices.find((c) => c.id === id)?.label ?? id,
      );
      if (otherSelected[q.id]) {
        const text = (otherText[q.id] ?? "").trim();
        if (text) parts.push(`其他：${text}`);
      }
      return { question: q.question, answer: parts.join("、") };
    });
    submitClarification({ tool, toolCallId, answers: responses });
  };

  return (
    <div className="border-border/80 bg-muted/30 my-3 w-full space-y-4 rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <HelpCircleIcon className="size-3.5 shrink-0" />
        <span>需要你确认</span>
      </div>
      {questions.map((q) => {
        const multi = isMultiClarifyQuestion(q.type);
        return (
          <div key={q.id} className="space-y-2">
            <p className="text-sm font-medium">
              {q.question}
              <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                {multi ? "（可多选）" : "（单选）"}
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              {q.choices.map((c) => {
                const selected = (answers[q.id] ?? []).includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={submitted}
                    onClick={() => toggle(q, c.id)}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border/60 hover:bg-muted/50",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors",
                        multi ? "rounded-[5px]" : "rounded-full",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/50",
                      )}
                    >
                      {selected &&
                        (multi ? (
                          <CheckIcon className="size-3" />
                        ) : (
                          <span className="bg-primary-foreground size-1.5 rounded-full" />
                        ))}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      {c.description && (
                        <span className="text-muted-foreground block text-xs">{c.description}</span>
                      )}
                    </span>
                  </button>
                );
              })}
              {(() => {
                const otherIsSelected = otherSelected[q.id] ?? false;
                return (
                  <div
                    className={cn(
                      "rounded-lg border text-sm transition-colors",
                      otherIsSelected ? "border-primary bg-primary/10" : "border-border/60",
                    )}
                  >
                    <button
                      type="button"
                      disabled={submitted}
                      onClick={() => toggleOther(q)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        !otherIsSelected && "hover:bg-muted/50",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors",
                          multi ? "rounded-[5px]" : "rounded-full",
                          otherIsSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/50",
                        )}
                      >
                        {otherIsSelected &&
                          (multi ? (
                            <CheckIcon className="size-3" />
                          ) : (
                            <span className="bg-primary-foreground size-1.5 rounded-full" />
                          ))}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium">其他（自行输入）</span>
                        {!otherIsSelected && (
                          <span className="text-muted-foreground block text-xs">
                            以上选项都不合适时，填写你的想法
                          </span>
                        )}
                      </span>
                    </button>
                    {otherIsSelected && (
                      <div className="pr-3 pb-2 pl-[2.375rem]">
                        <Input
                          autoFocus
                          disabled={submitted}
                          value={otherText[q.id] ?? ""}
                          onChange={(e) =>
                            setOtherText((prev) => ({ ...prev, [q.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && allAnswered && !submitted && !isRunning) {
                              e.preventDefault();
                              submit();
                            }
                          }}
                          placeholder="请输入你的想法…"
                          className="h-8 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
      <Button size="sm" disabled={!allAnswered || submitted || isRunning} onClick={submit}>
        {submitted ? "已提交" : "确认选择"}
      </Button>
    </div>
  );
};

/** Read-only recap of the user's clarify choice, shown once the form is answered. */
const ClarifyAnswerSummary: FC<{ answers: ClarifyAnswerEntry[] }> = ({ answers }) => {
  const lines = answers.map((a) => a.answer?.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="ms-auto my-2 flex max-w-[85%] flex-wrap items-center justify-end gap-1.5">
      <CheckIcon className="text-primary size-3.5" />
      {lines.map((line, i) => (
        <span
          key={i}
          className="border-border/60 bg-muted text-foreground rounded-full border px-2.5 py-1 text-xs"
        >
          {line}
        </span>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Dispatcher — routes an AI SDK tool part to its renderer              */
/* ------------------------------------------------------------------ */

/**
 * Routes the SQL agent's tools to their dedicated timeline cards, and any
 * other tool to the standard ToolFallback wrapped as a timeline step.
 */
export const ToolPart: FC<{ part: AnyToolUIPart }> = ({ part }) => {
  const name = getToolName(part);
  const props = toToolCardProps(part);

  switch (normalizeToolName(name)) {
    // clarifyrequest is rendered directly by the thread (it needs the sibling
    // approval data part for its questions), never through this dispatcher.
    case "executesql":
      return <ExecuteSqlTool {...props} />;
    case "introspectdatabase":
      return <IntrospectDatabaseTool {...props} />;
    case "reportdatagap":
      return <ReportDataGapTool {...props} />;
    default:
      return (
        <ChainOfThoughtStep
          icon={
            <ToolMarkerIcon>
              <WrenchIcon />
            </ToolMarkerIcon>
          }
        >
          <ToolFallback toolName={name} {...props} />
        </ChainOfThoughtStep>
      );
  }
};
