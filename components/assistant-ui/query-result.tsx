"use client";

import { useMemo, useState, type FC } from "react";
import { ChartColumnIcon, ChartLineIcon, TableIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Unified result surface for the SQL agent's results.
 *
 * One component renders a set of rows as a table, a line chart, or a bar chart,
 * with a view toggle. In the live flow the rows come from the GFM table the model
 * writes into its answer — `markdown-text.tsx` parses that table and hands the
 * rows here — so no chart spec is supplied and the mapping is inferred (first
 * non-numeric column → x, numeric columns → y), making the chart toggle work for
 * any result. An optional {@link ChartSpec} (preferred kind + x/y mapping) is
 * still honored when a caller has one.
 *
 * The charts are hand-rolled SVG so this runs with zero new dependencies. The
 * data contract (`rows` + `ChartSpec`) is identical to what a Recharts/shadcn
 * implementation would take, so the internals can be swapped later without
 * touching callers.
 */

/* ------------------------------------------------------------------ */
/* Public contract                                                     */
/* ------------------------------------------------------------------ */

export type ChartKind = "line" | "bar";

export type ChartSpec = {
  kind: ChartKind;
  /** Column used for the x axis / categories. */
  x: string;
  /** One or more numeric columns to plot as series. */
  y: string | string[];
};

export type QueryResultProps = {
  rows: Record<string, unknown>[];
  /** Model-provided preferred view + axis mapping. Optional. */
  chart?: ChartSpec;
  className?: string;
};

type ViewMode = "table" | ChartKind;

/* ------------------------------------------------------------------ */
/* Coercion + column inference                                         */
/* ------------------------------------------------------------------ */

const MAX_TABLE_ROWS = 20; // rows shown before the table body scrolls
const MAX_SERIES = 5; // matches --chart-1..--chart-5

const numFmtCompact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const numFmtFull = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const HAS_DIGIT = /\d/;

/**
 * A cell to treat as a gap rather than data: nullish, blank, or a non-numeric
 * placeholder that contains no digits at all — e.g. "—", "N/A", "无数据",
 * "—（无数据）". Crucially, such a cell must NOT on its own make an otherwise
 * numeric column read as textual (which would drop right-alignment and the chart
 * toggle); it just becomes a gap in the chart.
 */
function isMissing(value: unknown): boolean {
  if (value == null) return true;
  const s = typeof value === "string" ? value.trim() : String(value);
  return s === "" || !HAS_DIGIT.test(s);
}

/**
 * A column is numeric if at least one cell is a finite number and every cell that
 * isn't a gap (see {@link isMissing}) also coerces to one. A cell that has digits
 * but doesn't fully parse (e.g. "1,234家", "85%") still disqualifies the column,
 * since it's genuinely textual.
 */
function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  let seen = false;
  for (const row of rows) {
    const v = row[col];
    if (isMissing(v)) continue;
    if (toNumber(v) == null) return false;
    seen = true;
  }
  return seen;
}

function labelOf(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Cell text for a numeric column: group the integer part with separators for
 * readability, but keep decimals exactly as authored so no precision is lost
 * (e.g. `1840` → `1,840`, `0.07` → `0.07`).
 */
function numericLabel(value: unknown): string {
  const n = toNumber(value);
  if (n != null && Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString();
  return labelOf(value);
}

type Resolved = {
  columns: string[];
  numericColumns: string[];
  /** Effective mapping for the active chart (spec or inferred). */
  x: string;
  ys: string[];
  hasChart: boolean;
};

function resolve(rows: Record<string, unknown>[], chart?: ChartSpec): Resolved {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const numericColumns = columns.filter((c) => isNumericColumn(rows, c));

  const x = chart?.x ?? columns.find((c) => !numericColumns.includes(c)) ?? columns[0] ?? "";
  const specYs = chart ? (Array.isArray(chart.y) ? chart.y : [chart.y]) : [];
  const ys = (specYs.length ? specYs : numericColumns.filter((c) => c !== x)).slice(0, MAX_SERIES);

  return { columns, numericColumns, x, ys, hasChart: ys.length > 0 };
}

/* ------------------------------------------------------------------ */
/* Nice axis ticks                                                     */
/* ------------------------------------------------------------------ */

function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / 10 ** exp;
  let nice: number;
  if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

function niceScale(min: number, max: number, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const step = niceNum(niceNum(max - min, false) / count, true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(v);
  return { min: niceMin, max: niceMax, ticks };
}

/* ------------------------------------------------------------------ */
/* Chart view (SVG line + bar)                                         */
/* ------------------------------------------------------------------ */

const W = 720;
const H = 300;
const M = { top: 12, right: 16, bottom: 36, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const seriesColor = (i: number) => `var(--chart-${(i % MAX_SERIES) + 1})`;

const ChartView: FC<{
  rows: Record<string, unknown>[];
  kind: ChartKind;
  x: string;
  ys: string[];
}> = ({ rows, kind, x, ys }) => {
  const [hover, setHover] = useState<number | null>(null);
  const n = rows.length;

  const { series, scale, xLabels } = useMemo(() => {
    const series = ys.map((key, i) => ({
      key,
      color: seriesColor(i),
      points: rows.map((r) => toNumber(r[key])),
    }));
    const all = series.flatMap((s) => s.points).filter((v): v is number => v != null);
    let dataMin = all.length ? Math.min(...all) : 0;
    let dataMax = all.length ? Math.max(...all) : 1;
    if (kind === "bar") {
      dataMin = Math.min(0, dataMin);
      dataMax = Math.max(0, dataMax);
    }
    return {
      series,
      scale: niceScale(dataMin, dataMax),
      xLabels: rows.map((r) => labelOf(r[x])),
    };
  }, [rows, ys, x, kind]);

  const yPix = (v: number) => M.top + PLOT_H * (1 - (v - scale.min) / (scale.max - scale.min || 1));
  const baseline = yPix(0);

  // x anchor per row: evenly spaced points (line) / band centers (bar)
  const bandW = PLOT_W / Math.max(n, 1);
  const anchorX = (i: number) =>
    kind === "bar"
      ? M.left + bandW * (i + 0.5)
      : M.left + (n === 1 ? PLOT_W / 2 : (PLOT_W * i) / (n - 1));

  // thin x labels so they never overlap
  const labelStep = Math.max(1, Math.ceil(n / 10));

  return (
    <div className="relative mt-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img">
        {/* y grid + ticks */}
        {scale.ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={yPix(t)}
              y2={yPix(t)}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray={t === 0 ? undefined : "3 3"}
            />
            <text
              x={M.left - 8}
              y={yPix(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {numFmtCompact.format(t)}
            </text>
          </g>
        ))}

        {/* bars */}
        {kind === "bar" &&
          series.map((s, si) => {
            const groupW = bandW * 0.7;
            const barW = groupW / series.length;
            return s.points.map((v, i) => {
              if (v == null) return null;
              const x0 = anchorX(i) - groupW / 2 + barW * si;
              const y = yPix(v);
              return (
                <rect
                  key={`${s.key}-${i}`}
                  x={x0}
                  y={Math.min(y, baseline)}
                  width={Math.max(barW - 1, 1)}
                  height={Math.max(Math.abs(y - baseline), 1)}
                  fill={s.color}
                  opacity={hover == null || hover === i ? 1 : 0.35}
                  rx={1.5}
                />
              );
            });
          })}

        {/* lines + dots */}
        {kind === "line" &&
          series.map((s) => {
            let d = "";
            let pen = false;
            s.points.forEach((v, i) => {
              if (v == null) {
                pen = false;
                return;
              }
              d += `${pen ? "L" : "M"}${anchorX(i)} ${yPix(v)} `;
              pen = true;
            });
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
                {n <= 40 &&
                  s.points.map((v, i) =>
                    v == null ? null : (
                      <circle
                        key={i}
                        cx={anchorX(i)}
                        cy={yPix(v)}
                        r={hover === i ? 4 : 2.5}
                        fill={s.color}
                      />
                    ),
                  )}
              </g>
            );
          })}

        {/* x axis labels */}
        {xLabels.map((lbl, i) =>
          i % labelStep === 0 ? (
            <text
              key={i}
              x={anchorX(i)}
              y={H - M.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {lbl.length > 10 ? `${lbl.slice(0, 9)}…` : lbl}
            </text>
          ) : null,
        )}

        {/* hover guide */}
        {hover != null && (
          <line
            x1={anchorX(hover)}
            x2={anchorX(hover)}
            y1={M.top}
            y2={M.top + PLOT_H}
            className="stroke-muted-foreground/40"
            strokeWidth={1}
          />
        )}

        {/* pointer capture over the plot area */}
        <rect
          x={M.left}
          y={M.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const t = (e.clientX - r.left) / r.width;
            const idx = kind === "line" ? Math.round(t * (n - 1)) : Math.floor(t * n);
            setHover(Math.max(0, Math.min(n - 1, idx)));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {/* tooltip */}
      {hover != null && (
        <div
          className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(anchorX(hover) / W) * 100}%` }}
        >
          <div className="text-muted-foreground mb-1 font-medium">{xLabels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="inline-block size-2 rounded-[2px]"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-muted-foreground">{s.key}</span>
              <span className="ml-auto font-mono font-medium">
                {s.points[hover] == null ? "—" : numFmtFull.format(s.points[hover] as number)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* legend */}
      {ys.length > 1 && (
        <div className="text-muted-foreground mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-[2px]"
                style={{ backgroundColor: s.color }}
              />
              {s.key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Table view (caps at MAX_TABLE_ROWS, then scrolls; sticky header)    */
/* ------------------------------------------------------------------ */

const TableView: FC<{
  rows: Record<string, unknown>[];
  columns: string[];
  numeric: Set<string>;
}> = ({ rows, columns, numeric }) => {
  return (
    <div
      className="border-border/80 mt-2.5 max-h-[560px] overflow-auto overscroll-contain rounded-lg border"
      style={{ scrollbarWidth: "thin" }}
    >
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className={cn(
                  "bg-muted text-muted-foreground border-border/80 border-b px-3.5 py-1.5 font-mono text-[10px] font-medium tracking-[0.1em] uppercase",
                  numeric.has(col) ? "text-end" : "text-start",
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-border/40 bg-background border-b last:border-b-0">
              {columns.map((col) => {
                const v = row[col];
                const empty = v == null;
                const isNum = numeric.has(col);
                return (
                  <td
                    key={col}
                    className={cn(
                      "px-3.5 py-1.5 font-mono text-xs whitespace-nowrap",
                      isNum ? "text-end tabular-nums" : "text-start",
                      empty && "text-muted-foreground/60 italic",
                    )}
                  >
                    {empty ? "NULL" : isNum ? numericLabel(v) : labelOf(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Shell + view toggle                                                 */
/* ------------------------------------------------------------------ */

const TOGGLES: { mode: ViewMode; label: string; Icon: typeof TableIcon }[] = [
  { mode: "table", label: "表格", Icon: TableIcon },
  { mode: "line", label: "折线", Icon: ChartLineIcon },
  { mode: "bar", label: "柱状", Icon: ChartColumnIcon },
];

export const QueryResult: FC<QueryResultProps> = ({ rows, chart, className }) => {
  const { columns, numericColumns, x, ys, hasChart } = useMemo(
    () => resolve(rows, chart),
    [rows, chart],
  );
  const numeric = useMemo(() => new Set(numericColumns), [numericColumns]);
  const [view, setView] = useState<ViewMode>(chart?.kind ?? "table");

  if (rows.length === 0) {
    return <p className="text-muted-foreground mt-2.5 text-xs">返回 0 行</p>;
  }

  const mode: ViewMode = view !== "table" && !hasChart ? "table" : view;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground font-mono text-[11px]">
          {rows.length} 行
          {rows.length > MAX_TABLE_ROWS && mode === "table" ? " · 向下滚动查看更多" : ""}
        </span>
        {hasChart && (
          <div className="border-border/80 bg-muted/30 inline-flex gap-0.5 rounded-lg border p-0.5">
            {TOGGLES.map(({ mode: m, label, Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                aria-pressed={mode === m}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "table" ? (
        <TableView rows={rows} columns={columns} numeric={numeric} />
      ) : (
        <ChartView rows={rows} kind={mode} x={x} ys={ys} />
      )}
    </div>
  );
};
