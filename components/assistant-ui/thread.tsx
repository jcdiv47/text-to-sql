import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  ChainOfThoughtGroup,
  ChainOfThoughtReasoning,
  ChainOfThoughtText,
  useChainOfThoughtGroupBy,
} from "@/components/assistant-ui/chain-of-thought";
import { TimelineToolCall } from "@/components/assistant-ui/sql-tools";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { getThreadMessageTokenUsage, type ThreadTokenUsage } from "@assistant-ui/react-ai-sdk";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartColumnIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudSunIcon,
  CodeXmlIcon,
  CopyIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PencilLineIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { useState, type FC, type ReactNode } from "react";

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);

const USAGE_MODEL_PRICING: { inputPerMTok: number; outputPerMTok: number } | null = {
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

function getEstimatedCost(usage: ThreadTokenUsage): number | null {
  if (USAGE_MODEL_PRICING == null || usage.inputTokens == null || usage.outputTokens == null) {
    return null;
  }

  return (
    (usage.inputTokens * USAGE_MODEL_PRICING.inputPerMTok +
      usage.outputTokens * USAGE_MODEL_PRICING.outputPerMTok) /
    1_000_000
  );
}

export const Thread: FC = () => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className={cn(
          "relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4",
          isEmpty && "justify-center",
        )}
      >
        <AuiIf condition={isNewChatView}>
          <ThreadWelcome />
        </AuiIf>

        <div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-6 empty:hidden">
          <ThreadPrimitive.Messages>
            {({ message }) => {
              if (message.composer.isEditing) return <EditComposer />;
              if (message.role === "user") return <UserMessage />;
              return <AssistantMessage />;
            }}
          </ThreadPrimitive.Messages>
        </div>

        <ThreadPrimitive.ViewportFooter
          className={cn(
            "aui-thread-viewport-footer bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible pb-4 md:pb-6",
            !isEmpty && "sticky bottom-0 mt-auto rounded-t-xl",
          )}
        >
          <ThreadScrollToBottom />
          <Composer />
          <AuiIf condition={isNewChatView}>
            <div className="aui-thread-welcome-suggestions-shell min-h-19">
              <AuiIf condition={(s) => s.composer.isEmpty}>
                <ThreadSuggestions />
              </AuiIf>
            </div>
          </AuiIf>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        今天想查什么数据？
      </h1>
    </div>
  );
};

type SuggestionGroup = {
  label: string;
  icon: ReactNode;
  options: { label: string; prompt: string }[];
};

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    label: "表结构",
    icon: <CodeXmlIcon />,
    options: [
      { label: "查看数据表", prompt: "看一下数据库里有哪些表。" },
      {
        label: "说明字段",
        prompt: "帮我说明一下数据库里的字段含义和表之间的关系。",
      },
      {
        label: "查找主外键",
        prompt: "帮我找出这个库里的主键和外键关系。",
      },
    ],
  },
  {
    label: "写查询",
    icon: <PencilLineIcon />,
    options: [
      {
        label: "写 SELECT",
        prompt: "根据我接下来要问的问题，帮我写一条 SQL 查询。",
      },
      {
        label: "关联多表",
        prompt: "帮我写一条 SQL，把最相关的几张表关联起来查询。",
      },
      {
        label: "筛选记录",
        prompt: "针对一个具体的业务问题，告诉我应该怎么筛选数据。",
      },
    ],
  },
  {
    label: "做分析",
    icon: <ChartColumnIcon />,
    options: [
      {
        label: "总结数据",
        prompt: "帮我总结这个数据库里最重要的数据特征和趋势。",
      },
      {
        label: "对比分组",
        prompt: "写一条 SQL，对比数据中几个重要分组的差异。",
      },
      {
        label: "发现异常",
        prompt: "帮我找出数据里的异常值或不太寻常的记录。",
      },
    ],
  },
  {
    label: "探索数据",
    icon: <CloudSunIcon />,
    options: [
      {
        label: "查看样例",
        prompt: "从最有用的几张表里，给我看一些简单的样例记录。",
      },
      {
        label: "统计行数",
        prompt: "统计每张表的行数，并帮我总结结果。",
      },
      {
        label: "检查质量",
        prompt: "检查数据库里的缺失值和其他数据质量问题。",
      },
    ],
  },
];

const suggestionChipClass =
  "aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors [&_svg]:size-4";

const ThreadSuggestions: FC = () => {
  const aui = useAui();
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const expandedGroup = SUGGESTION_GROUPS.find((group) => group.label === expandedLabel);

  const sendPrompt = (prompt: string) => {
    if (aui.thread().getState().isRunning) return;
    aui.thread().append({
      content: [{ type: "text", text: prompt }],
      runConfig: aui.composer().getState().runConfig,
    });
  };

  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col gap-2 px-4">
      <div className="scrollbar-none w-full overflow-x-auto">
        <div className="mx-auto flex w-max items-center gap-2">
          {SUGGESTION_GROUPS.map((group) => (
            <Button
              key={group.label}
              variant="ghost"
              className={cn(suggestionChipClass, group.label === expandedLabel && "bg-muted")}
              onClick={() => setExpandedLabel(group.label === expandedLabel ? null : group.label)}
            >
              {group.icon}
              {group.label}
            </Button>
          ))}
        </div>
      </div>
      {expandedGroup && (
        <div
          key={expandedGroup.label}
          className="fade-in slide-in-from-top-1 animate-in scrollbar-none w-full overflow-x-auto duration-200"
        >
          <div className="mx-auto flex w-max items-center gap-2">
            {expandedGroup.options.map((option) => (
              <Button
                key={option.label}
                variant="ghost"
                className={suggestionChipClass}
                onClick={() => sendPrompt(option.prompt)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className="bg-background border-border/60 data-[dragging=true]:border-ring data-[dragging=true]:bg-accent/50 focus-within:border-border dark:border-muted-foreground/15 dark:bg-muted/30 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-3xl border p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed dark:shadow-none"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="Send a message..."
            className="aui-composer-input placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
            rows={1}
            autoFocus
            aria-label="Message input"
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <div className="flex items-center gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate size-7 rounded-full"
                aria-label="Start voice input"
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label="Stop voice input"
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const groupBy = useChainOfThoughtGroupBy();
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative mx-auto w-full max-w-(--thread-max-width) duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        // [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
        className="text-foreground px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
      >
        <MessagePrimitive.GroupedParts indicator="always" groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return (
                  <ChainOfThoughtGroup
                    indices={part.indices}
                    running={part.status.type === "running"}
                  >
                    {children}
                  </ChainOfThoughtGroup>
                );
              case "group-reasoning":
                return <ChainOfThoughtReasoning>{children}</ChainOfThoughtReasoning>;
              case "group-cotText":
                return <ChainOfThoughtText>{children}</ChainOfThoughtText>;
              case "group-tool":
                return <>{children}</>; // each tool call renders as its own timeline step
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <TimelineToolCall {...part} />;
              case "indicator":
                return <AssistantMessageIndicator />;
              case "data":
                return part.dataRendererUI;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center gap-1", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantUsage />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantMessageIndicator: FC = () => {
  const shouldShow = useAuiState((s) => {
    const lastPart = s.message.parts.at(-1);
    return !lastPart || (lastPart.type !== "text" && lastPart.type !== "reasoning");
  });

  if (!shouldShow) return null;

  return (
    <span
      data-slot="aui_assistant-message-indicator"
      className="text-muted-foreground inline-flex items-center gap-2 font-sans text-sm"
      aria-label="Assistant is working"
    >
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
    </span>
  );
};

const AssistantUsage: FC = () => {
  const usage = useAuiState((s) => getThreadMessageTokenUsage(s.message));
  if (!usage) return null;

  const totalTokens = usage.totalTokens;
  const cost = getEstimatedCost(usage);
  if ((totalTokens == null || totalTokens <= 0) && (cost == null || cost <= 0)) {
    return null;
  }

  return (
    <span className="aui-assistant-usage text-muted-foreground/80 inline-flex items-center gap-1.5 text-xs tabular-nums">
      {totalTokens != null && totalTokens > 0 && <span>{formatTokens(totalTokens)} tokens</span>}
      {totalTokens != null && totalTokens > 0 && cost != null && cost > 0 && (
        <span className="text-muted-foreground/50">·</span>
      )}
      {cost != null && cost > 0 && <span>~{formatCost(cost)}</span>}
    </span>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root bg-background border-border/60 dark:border-muted-foreground/15 dark:bg-muted/30 ms-auto flex w-full max-w-[85%] flex-col rounded-3xl border shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 rounded-full px-3.5">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
