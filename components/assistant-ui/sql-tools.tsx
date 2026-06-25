"use client";

import { useMemo, useState, type FC, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  HelpCircleIcon,
  LoaderIcon,
  TableIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { getToolOrDynamicToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
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
  normalizeToolName(getToolOrDynamicToolName(part)) === "clarifyrequest";

/** True when a clarify call actually asks the user something (needs an answer). */
export const isClarifyAskPart = (part: AnyToolUIPart): boolean => {
  if (!isClarifyToolPart(part)) return false;
  const output = (part as { output?: ClarifyResult }).output;
  return Boolean(output?.needsClarification && (output.questions?.length ?? 0) > 0);
};

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
            <span className="text-muted-foreground">Running…</span>
            <span
              aria-hidden
              className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
            >
              Running…
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
    return <p className="text-muted-foreground mt-2.5 text-xs">0 rows returned</p>;
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
          +{hidden} more {hidden === 1 ? "row" : "rows"}
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
  const meta =
    rowCount !== undefined ? `${rowCount} ${rowCount === 1 ? "row" : "rows"}` : undefined;

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
        preview={flat ? <HighlightedSql sql={flat} /> : "executeSql"}
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
  const meta =
    tableCount !== undefined ? `${tableCount} ${tableCount === 1 ? "table" : "tables"}` : undefined;

  return (
    <ChainOfThoughtStep
      icon={
        <ToolMarkerIcon>
          <TableIcon />
        </ToolMarkerIcon>
      }
    >
      <TimelineToolCard state={state} meta={meta} preview="introspectDatabase">
        <ToolError state={state} errorText={errorText} />
        {schema ? (
          <pre className="bg-background/60 border-border/60 max-h-64 overflow-auto rounded-lg border px-3.5 py-2.5 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap">
            {schema}
          </pre>
        ) : (
          <p className="text-muted-foreground text-xs">Reading schema…</p>
        )}
      </TimelineToolCard>
    </ChainOfThoughtStep>
  );
};

/* ------------------------------------------------------------------ */
/* clarifyRequest                                                       */
/* ------------------------------------------------------------------ */

type ClarifyChoice = { id: string; label: string; description?: string };
type ClarifyQuestion = {
  id: string;
  type: "single_choice" | "multi_choice";
  question: string;
  choices: ClarifyChoice[];
};
type ClarifyResult = { needsClarification?: boolean; questions?: ClarifyQuestion[] };

/**
 * Renders the clarify-request tool's questions as clickable single/multi
 * choice options. On submit, the selection is sent back to the thread as a
 * follow-up message, which resumes the agent so it can generate the SQL.
 */
const ClarifyRequestTool: FC<ToolCardProps> = ({ state, output }) => {
  const { sendMessage, isRunning } = useChatActions();
  const questions = (output as ClarifyResult | undefined)?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggle = (q: ClarifyQuestion, choiceId: string) =>
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === "single_choice") return { ...prev, [q.id]: [choiceId] };
      return {
        ...prev,
        [q.id]: cur.includes(choiceId) ? cur.filter((c) => c !== choiceId) : [...cur, choiceId],
      };
    });

  const allAnswered =
    questions.length > 0 && questions.every((q) => (answers[q.id]?.length ?? 0) > 0);

  const submit = () => {
    if (submitted || !allAnswered) return;
    setSubmitted(true);
    // Concise confirmation: a "✓ 已选择" header + one line of chosen labels per
    // question (in order). The agent maps each line to its question via the
    // clarify tool result that immediately precedes this message in context.
    const lines = questions.map((q) =>
      (answers[q.id] ?? []).map((id) => q.choices.find((c) => c.id === id)?.label ?? id).join("、"),
    );
    sendMessage(`✓ 已选择\n${lines.join("\n")}`);
  };

  // No questions yet: a compact hint while the clarify agent drafts, or
  // nothing once it decides no clarification is needed.
  if (questions.length === 0) {
    if (toolIsRunning(state)) {
      return (
        <div className="text-muted-foreground my-2 flex items-center gap-2 text-sm">
          <LoaderIcon className="size-4 shrink-0 animate-spin" aria-hidden />
          <span>正在准备澄清选项…</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="border-border/80 bg-muted/30 my-3 w-full space-y-4 rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <HelpCircleIcon className="size-3.5 shrink-0" />
        <span>需要你确认</span>
      </div>
      {questions.map((q) => {
        const multi = q.type === "multi_choice";
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

/* ------------------------------------------------------------------ */
/* Dispatcher — routes an AI SDK tool part to its renderer              */
/* ------------------------------------------------------------------ */

/**
 * Routes the SQL agent's tools to their dedicated timeline cards, and any
 * other tool to the standard ToolFallback wrapped as a timeline step.
 */
export const ToolPart: FC<{ part: AnyToolUIPart }> = ({ part }) => {
  const name = getToolOrDynamicToolName(part);
  const props = toToolCardProps(part);

  switch (normalizeToolName(name)) {
    case "clarifyrequest":
      return <ClarifyRequestTool {...props} />;
    case "executesql":
      return <ExecuteSqlTool {...props} />;
    case "introspectdatabase":
      return <IntrospectDatabaseTool {...props} />;
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
