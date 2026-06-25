"use client";

import {
  useEffect,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

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
        setDuration(Math.max(1, Math.round((Date.now() - startRef.current!) / 1000)));
      tick();
      const iv = setInterval(tick, 1000);
      return () => clearInterval(iv);
    }
    if (startRef.current != null) {
      setDuration(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
    }
  }, [running]);

  return duration;
}

/**
 * One step on the timeline rail. Renders the marker column (node + connecting
 * line, hidden on the last step) and the step body. Used for reasoning steps
 * and tool-call cards.
 */
export const ChainOfThoughtStep: FC<
  PropsWithChildren<{ icon?: ReactNode; className?: string }>
> = ({ icon, className, children }) => {
  return (
    <div
      data-slot="cot-step"
      className={cn("aui-cot-step group/step grid grid-cols-[20px_1fr] gap-x-3.5", className)}
    >
      <div className="flex flex-col items-center">
        {icon ?? <div className="bg-muted-foreground/60 mt-2 size-1.5 shrink-0 rounded-full" />}
        <div className="bg-border mt-1.5 w-px flex-1 group-last/step:hidden" />
      </div>
      <div className="min-w-0 pb-4 group-last/step:pb-1">{children}</div>
    </div>
  );
};

/** Reasoning rendered as a timeline step: dot marker + muted streamed text. */
export const ChainOfThoughtReasoning: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ChainOfThoughtStep>
      <div
        data-slot="cot-reasoning"
        className={cn(
          "aui-cot-reasoning text-muted-foreground space-y-3 pt-0.5 text-[13px] leading-relaxed",
          "[&_code]:border-border/80 [&_code]:bg-muted/60 [&_code]:rounded-[5px] [&_code]:border [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[11px] [&_code]:whitespace-nowrap",
        )}
      >
        {children}
      </div>
    </ChainOfThoughtStep>
  );
};

/** Interim assistant narration rendered as a timeline step (muted text). */
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

export type ChainOfThoughtGroupProps = PropsWithChildren<{
  /** Whether this message's turn is still streaming. */
  running: boolean;
  /** Number of tool calls in the group, shown in the collapsed header. */
  toolCount: number;
}>;

/**
 * The collapsible "Thought for Xs · N tool calls" container around an entire
 * chain of thought (reasoning + tool calls). Auto-expands while the turn
 * streams and folds ~1s after it finishes; a user toggle always wins.
 */
export const ChainOfThoughtGroup: FC<ChainOfThoughtGroupProps> = ({
  running,
  toolCount,
  children,
}) => {
  const duration = useThoughtDuration(running);
  const [open, setOpen] = useState(running);
  const userToggledRef = useRef(false);
  const prevRunningRef = useRef(running);

  useEffect(() => {
    const was = prevRunningRef.current;
    prevRunningRef.current = running;
    if (userToggledRef.current) return;
    if (running && !was) setOpen(true);
    if (!running && was) {
      const t = setTimeout(() => setOpen(false), 900);
      return () => clearTimeout(t);
    }
  }, [running]);

  const label = running ? "Working…" : duration != null ? `Thought for ${duration}s` : "Thought";

  return (
    <Collapsible
      data-slot="cot-root"
      open={open}
      onOpenChange={(next) => {
        userToggledRef.current = true;
        setOpen(next);
      }}
      className="aui-cot-root group/cot-root mb-4 w-full"
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
    >
      <CollapsibleTrigger
        data-slot="cot-trigger"
        className="aui-cot-trigger group/trigger text-muted-foreground hover:text-foreground flex max-w-full items-center gap-2 py-1 text-sm transition-colors"
      >
        {running && <LoaderIcon className="size-3.5 shrink-0 animate-spin" aria-hidden />}
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
