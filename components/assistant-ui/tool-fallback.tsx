"use client";

import { useState, type FC } from "react";
import { CheckIcon, ChevronDownIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import type { ToolUIPart } from "ai";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

export type ToolFallbackProps = {
  toolName: string;
  state: ToolUIPart["state"];
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const stringify = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** Generic renderer for tools without a dedicated card. */
export const ToolFallback: FC<ToolFallbackProps> = ({
  toolName,
  state,
  input,
  output,
  errorText,
}) => {
  const running = state === "input-streaming" || state === "input-available";
  const isError = state === "output-error";
  const [open, setOpen] = useState(false);

  const Icon = running ? LoaderIcon : isError ? XCircleIcon : CheckIcon;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="aui-tool-fallback-root group/tool-fallback-root w-full rounded-lg border py-3"
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
    >
      <CollapsibleTrigger className="aui-tool-fallback-trigger group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors">
        <Icon
          className={cn(
            "size-4 shrink-0",
            running && "animate-spin",
            isError && "text-destructive",
          )}
        />
        <span className="relative inline-block grow text-start leading-none">
          <span>
            Used tool: <b>{toolName}</b>
          </span>
          {running && (
            <span
              aria-hidden
              className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
            >
              Used tool: <b>{toolName}</b>
            </span>
          )}
        </span>
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
        className={cn(
          "aui-tool-fallback-content relative overflow-hidden text-sm outline-none",
          "data-[state=closed]:animate-collapsible-up",
          "data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:fill-mode-forwards",
          "data-[state=open]:duration-(--animation-duration)",
          "data-[state=closed]:duration-(--animation-duration)",
        )}
      >
        <div className="mt-3 flex flex-col gap-2 border-t pt-2">
          {errorText && (
            <div className="px-4">
              <p className="text-muted-foreground font-semibold">Error:</p>
              <p className="text-muted-foreground">{errorText}</p>
            </div>
          )}
          {input !== undefined && (
            <div className="px-4">
              <pre className="whitespace-pre-wrap">{stringify(input)}</pre>
            </div>
          )}
          {output !== undefined && (
            <div className="border-t border-dashed px-4 pt-2">
              <p className="font-semibold">Result:</p>
              <pre className="whitespace-pre-wrap">{stringify(output)}</pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
