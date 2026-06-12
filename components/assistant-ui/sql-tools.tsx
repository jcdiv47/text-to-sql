"use client";

import { useMemo, type FC, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  LoaderIcon,
  TableIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
  ToolCallMessagePartStatus,
} from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChainOfThoughtStep } from "@/components/assistant-ui/chain-of-thought";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";

const ANIMATION_DURATION = 200;

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

/**
 * Best-effort extraction of the `query` arg while args are still streaming
 * (argsText is partial JSON until the tool call finishes).
 */
function extractQuery(args: unknown, argsText: string | undefined): string {
  const direct = (args as { query?: unknown } | undefined)?.query;
  if (typeof direct === "string" && direct.length > 0) return direct;
  if (!argsText) return "";
  try {
    const parsed = JSON.parse(argsText) as { query?: string };
    if (typeof parsed.query === "string") return parsed.query;
  } catch {
    const m = /"query"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(argsText);
    if (m) {
      return m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }
  return "";
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
  status?: ToolCallMessagePartStatus;
  /** mono one-line preview shown in the collapsed header */
  preview: ReactNode;
  /** right-aligned mono metadata, e.g. "1 row" — hidden while running */
  meta?: string;
  children: ReactNode;
};

/**
 * The collapsible card body of a tool step. Spinner + shimmering "Running…"
 * while the tool executes; check / error icon + metadata once settled.
 */
const TimelineToolCard: FC<TimelineToolCardProps> = ({ status, preview, meta, children }) => {
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isError = statusType === "incomplete";

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
        {isRunning ? (
          <LoaderIcon className="text-muted-foreground size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : isError ? (
          <XCircleIcon className="text-destructive size-3.5 shrink-0" aria-hidden />
        ) : (
          <CheckIcon className="size-3.5 shrink-0 text-[oklch(0.55_0.15_162)] dark:text-[oklch(0.7_0.17_162)]" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{preview}</span>
        {isRunning ? (
          <span className="relative shrink-0 text-[11px] font-medium">
            <span className="text-muted-foreground">Running…</span>
            <span aria-hidden className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none">
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

const ToolError: FC<{ status?: ToolCallMessagePartStatus }> = ({ status }) => {
  if (status?.type !== "incomplete" || !status.error) return null;
  const text = typeof status.error === "string" ? status.error : JSON.stringify(status.error);
  return <p className="text-destructive mb-2 text-xs">{text}</p>;
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

export const ExecuteSqlTool: ToolCallMessagePartComponent = ({ args, argsText, result, status }) => {
  const query = extractQuery(args, argsText);
  const flat = query.replace(/\s+/g, " ").trim();
  const typedResult = (result ?? undefined) as ExecuteSqlResult | undefined;
  const rowCount = typedResult?.rowCount ?? typedResult?.rows?.length;
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
        status={status}
        meta={meta}
        preview={flat ? <HighlightedSql sql={flat} /> : "executeSql"}
      >
        <ToolError status={status} />
        {query && (
          <pre className="bg-background/60 border-border/60 overflow-x-auto rounded-lg border px-3.5 py-2.5 font-mono text-xs leading-[1.8] whitespace-pre-wrap">
            <HighlightedSql sql={query} />
          </pre>
        )}
        {typedResult?.rows && <SqlResultTable rows={typedResult.rows} />}
      </TimelineToolCard>
    </ChainOfThoughtStep>
  );
};

/* ------------------------------------------------------------------ */
/* introspectDatabase                                                   */
/* ------------------------------------------------------------------ */

type IntrospectResult = { schema?: string };

export const IntrospectDatabaseTool: ToolCallMessagePartComponent = ({ result, status }) => {
  const schema = ((result ?? undefined) as IntrospectResult | undefined)?.schema;
  const tableCount = schema ? (schema.match(/(^|\n)## /g) ?? []).length : undefined;
  const meta =
    tableCount !== undefined
      ? `${tableCount} ${tableCount === 1 ? "table" : "tables"}`
      : undefined;

  return (
    <ChainOfThoughtStep
      icon={
        <ToolMarkerIcon>
          <TableIcon />
        </ToolMarkerIcon>
      }
    >
      <TimelineToolCard status={status} meta={meta} preview="introspectDatabase">
        <ToolError status={status} />
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
/* Dispatcher — use this in thread.tsx for the `tool-call` part case    */
/* ------------------------------------------------------------------ */

/**
 * Routes the SQL agent's tools to their dedicated timeline cards, and any
 * other tool to the standard ToolFallback wrapped as a timeline step.
 */
export const TimelineToolCall: FC<ToolCallMessagePartProps> = (props) => {
  switch (props.toolName) {
    case "executeSql":
    case "execute-sql":
      return <ExecuteSqlTool {...props} />;
    case "introspectDatabase":
    case "introspect-database":
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
          <ToolFallback {...props} />
        </ChainOfThoughtStep>
      );
  }
};
