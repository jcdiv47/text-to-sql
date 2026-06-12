"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { MessagePrimitive, groupPartByType, useAuiState } from "@assistant-ui/react";
import { getThreadMessageTokenUsage } from "@assistant-ui/react-ai-sdk";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

/**
 * USD per 1M tokens for the agent's model — drives the cost chip in the
 * group header. ⚠ Placeholder rates: set these to your model's actual
 * OpenRouter pricing, or set the whole constant to `null` to hide cost
 * and show only tokens.
 */
const MODEL_PRICING: { inputPerMTok: number; outputPerMTok: number } | null = {
  inputPerMTok: 0.1,
  outputPerMTok: 0.3,
};

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatCost(usd: number): string {
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

/**
 * Tracks how long a chain-of-thought ran. Returns elapsed seconds while
 * running (ticking), the frozen final value once finished, or null for
 * historical messages that were never observed running.
 */
function useThoughtDuration(running: boolean): number | null {
  const startRef = useRef<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    if (running) {
      if (startRef.current == null) startRef.current = Date.now();
      const tick = () =>
        setDuration(
          Math.max(1, Math.round((Date.now() - startRef.current!) / 1000)),
        );
      tick();
      const iv = setInterval(tick, 1000);
      return () => clearInterval(iv);
    }
    if (startRef.current != null) {
      setDuration(
        Math.max(1, Math.round((Date.now() - startRef.current) / 1000)),
      );
    }
  }, [running]);

  return duration;
}

/**
 * One step on the timeline rail. Renders the marker column (node + connecting
 * line, hidden on the last step) and the step body. Used by
 * ChainOfThoughtReasoning and TimelineToolCall.
 */
export const ChainOfThoughtStep: FC<
  PropsWithChildren<{ icon?: ReactNode; className?: string }>
> = ({ icon, className, children }) => {
  return (
    <div
      data-slot="cot-step"
      className={cn(
        "aui-cot-step group/step grid grid-cols-[20px_1fr] gap-x-3.5",
        className,
      )}
    >
      <div className="flex flex-col items-center">
        {icon ?? (
          <div className="bg-muted-foreground/60 mt-2 size-1.5 shrink-0 rounded-full" />
        )}
        <div className="bg-border mt-1.5 w-px flex-1 group-last/step:hidden" />
      </div>
      <div className="min-w-0 pb-4 group-last/step:pb-1">{children}</div>
    </div>
  );
};

/**
 * Reasoning rendered as a timeline step: dot marker + muted streamed text.
 * Wrap the `group-reasoning` children (MarkdownText) with this.
 */
export const ChainOfThoughtReasoning: FC<PropsWithChildren> = ({
  children,
}) => {
  return (
    <ChainOfThoughtStep>
      <div
        data-slot="cot-reasoning"
        className={cn(
          "aui-cot-reasoning text-muted-foreground space-y-3 pt-0.5 text-[13px] leading-relaxed",
          // inline code chips (table / column names)
          "[&_code]:border-border/80 [&_code]:bg-muted/60 [&_code]:rounded-[5px] [&_code]:border [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[11px] [&_code]:whitespace-nowrap",
        )}
      >
        {children}
      </div>
    </ChainOfThoughtStep>
  );
};

export type ChainOfThoughtGroupProps = PropsWithChildren<{
  /** `part.indices` of the group-chainOfThought part */
  indices: readonly number[];
  /** `part.status.type === "running"` */
  running: boolean;
}>;

type GroupBy = NonNullable<
  React.ComponentProps<typeof MessagePrimitive.GroupedParts>["groupBy"]
>;

/**
 * Position-aware groupBy for `<MessagePrimitive.GroupedParts>`. Same as the
 * plain groupPartByType config, plus: text parts that are FOLLOWED by another
 * reasoning/tool-call part are interim narration ("Result is 0, let me
 * check…") and fold into the chain of thought as `group-cotText` steps. Only
 * the trailing text run — the final answer — renders outside the fold.
 * Because the test is "is anything after it", a streaming text stays outside
 * (visible) and folds in the moment the next tool call begins.
 *
 * Must be called inside the assistant message (e.g. top of AssistantMessage).
 */
export function useChainOfThoughtGroupBy(): GroupBy {
  const parts = useAuiState((s) => s.message.parts);

  return useMemo<GroupBy>(() => {
    let lastStepIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const type = parts[i]?.type;
      if (type === "reasoning" || type === "tool-call") {
        lastStepIndex = i;
        break;
      }
    }

    const base = groupPartByType({
      reasoning: ["group-chainOfThought", "group-reasoning"],
      "tool-call": ["group-chainOfThought", "group-tool"],
      "standalone-tool-call": [],
    });

    return ((part, context) => {
      if (part.type === "text" && parts.indexOf(part) < lastStepIndex) {
        return ["group-chainOfThought", "group-cotText"];
      }
      return base(part, context);
    }) as GroupBy;
  }, [parts]);
}

/**
 * Interim assistant narration rendered as a timeline step (dot marker +
 * muted text). Wrap the `group-cotText` children (MarkdownText) with this.
 */
export const ChainOfThoughtText: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ChainOfThoughtStep>
      <div
        data-slot="cot-text"
        className={cn(
          "aui-cot-text text-muted-foreground pt-0.5 text-[13px] leading-relaxed",
          "[&_code]:border-border/80 [&_code]:bg-muted/60 [&_code]:rounded-[5px] [&_code]:border [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[11px] [&_code]:whitespace-nowrap",
        )}
      >
        {children}
      </div>
    </ChainOfThoughtStep>
  );
};

/**
 * The collapsible "Thought for Xs · N tool calls" container around an entire
 * chain of thought (reasoning + tool calls). Live-expands while streaming.
 * Auto-collapse is keyed to the MESSAGE run, not this group's own status —
 * an intermediate group whose last part has completed stays open while the
 * assistant keeps working (next thought / tool call / final answer still
 * streaming); every group folds together ~1s after the whole turn ends.
 * A user toggle always wins over the automatic behavior.
 */
export const ChainOfThoughtGroup: FC<ChainOfThoughtGroupProps> = ({
  indices,
  running,
  children,
}) => {
  const toolCount = useAuiState(
    (s) =>
      indices.filter((i) => s.message.parts[i]?.type === "tool-call").length,
  );
  // The whole-turn signal that drives auto open/collapse. `running` (this
  // group's own status) only drives the spinner/shimmer and duration ticker.
  const messageRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );
  // Usage arrives via message metadata once the run finishes — requires the
  // usage TransformStream in app/api/chat/route.ts (see handoff README).
  const usage = useAuiState((s) => getThreadMessageTokenUsage(s.message));
  const totalTokens = usage?.totalTokens;
  const cost =
    MODEL_PRICING != null &&
    usage?.inputTokens != null &&
    usage?.outputTokens != null
      ? (usage.inputTokens * MODEL_PRICING.inputPerMTok +
          usage.outputTokens * MODEL_PRICING.outputPerMTok) /
        1_000_000
      : null;
  const duration = useThoughtDuration(running);

  const [open, setOpen] = useState(messageRunning);
  const userToggledRef = useRef(false);
  const prevMessageRunningRef = useRef(messageRunning);

  useEffect(() => {
    const was = prevMessageRunningRef.current;
    prevMessageRunningRef.current = messageRunning;
    if (userToggledRef.current) return;
    if (messageRunning && !was) setOpen(true);
    if (!messageRunning && was) {
      const t = setTimeout(() => setOpen(false), 900);
      return () => clearTimeout(t);
    }
  }, [messageRunning]);

  const label = running
    ? "Working…"
    : duration != null
      ? `Thought for ${duration}s`
      : "Thought";

  return (
    <Collapsible
      data-slot="cot-root"
      open={open}
      onOpenChange={(next) => {
        userToggledRef.current = true;
        setOpen(next);
      }}
      className="aui-cot-root group/cot-root mb-4 w-full"
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
    >
      <CollapsibleTrigger
        data-slot="cot-trigger"
        className="aui-cot-trigger group/trigger text-muted-foreground hover:text-foreground flex max-w-full items-center gap-2 py-1 text-sm transition-colors"
      >
        {running && (
          <LoaderIcon className="size-3.5 shrink-0 animate-spin" aria-hidden />
        )}
        <span className="relative inline-block leading-none">
          <span className="text-foreground/80 font-medium">{label}</span>
          {running && (
            <span
              aria-hidden
              className="shimmer pointer-events-none absolute inset-0 font-medium motion-reduce:animate-none"
            >
              {label}
            </span>
          )}
        </span>
        {!running && toolCount > 0 && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {toolCount} tool {toolCount === 1 ? "call" : "calls"}
            </span>
          </>
        )}
        {!running && totalTokens != null && totalTokens > 0 && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="whitespace-nowrap">
              {formatTokens(totalTokens)} tokens
            </span>
          </>
        )}
        {!running && cost != null && cost > 0 && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="whitespace-nowrap">{formatCost(cost)}</span>
          </>
        )}
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0",
            "transition-transform duration-(--animation-duration) ease-out",
            "group-data-[state=closed]/trigger:-rotate-90",
            "group-data-[state=open]/trigger:rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        data-slot="cot-content"
        className={cn(
          "aui-cot-content relative overflow-hidden outline-none",
          "group/collapsible-content ease-out",
          "data-[state=closed]:animate-collapsible-up",
          "data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:fill-mode-forwards",
          "data-[state=closed]:pointer-events-none",
          "data-[state=open]:duration-(--animation-duration)",
          "data-[state=closed]:duration-(--animation-duration)",
        )}
      >
        <div className="flex flex-col pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};
