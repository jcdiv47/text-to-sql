"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { isToolUIPart, type UIMessage } from "ai";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartColumnIcon,
  CheckIcon,
  CloudSunIcon,
  CodeXmlIcon,
  CopyIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  ChainOfThoughtGroup,
  ChainOfThoughtReasoning,
  ChainOfThoughtText,
} from "@/components/assistant-ui/chain-of-thought";
import {
  ClarifyExchange,
  ToolPart,
  WorkflowClarifyForm,
  getSuspendedClarify,
  isClarifyToolPart,
} from "@/components/assistant-ui/sql-tools";
import { ChatActionsProvider } from "@/components/assistant-ui/chat-context";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { getChat, hasChat } from "@/lib/chat-registry";
import { setThreadStatus, useSaveFailed } from "@/lib/chat-status";

const messageText = (message: UIMessage): string =>
  message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

export const Thread: FC<{ threadId: Id<"threads"> }> = ({ threadId }) => {
  // Seed the registry chat from the thread's persisted messages. If an instance
  // already exists it owns the messages, so render at once; otherwise wait for
  // the query to resolve before creating it. We must NOT seed from `[]` until
  // the load completes — doing so for a thread that actually has history would
  // create an empty chat and let the next turn overwrite real messages. A new
  // thread simply resolves to `[]` quickly, so the wait is a brief placeholder,
  // not data loss.
  const rows = useQuery(api.messages.list, { threadId });
  // Rows are JSON strings (see convex/messages.ts); parse back to UIMessages,
  // dropping any unparseable row rather than failing the whole thread.
  const seed = useMemo<UIMessage[]>(
    () =>
      (rows ?? []).flatMap((row) => {
        try {
          return [JSON.parse(row) as UIMessage];
        } catch {
          return [];
        }
      }),
    [rows],
  );
  const ready = hasChat(threadId) || rows !== undefined;
  if (!ready) return <div className="bg-background h-full" />;
  return <ThreadView threadId={threadId} seed={seed} />;
};

const ThreadView: FC<{ threadId: Id<"threads">; seed: UIMessage[] }> = ({ threadId, seed }) => {
  // Bind to the thread's live, registry-owned chat so it keeps streaming after
  // you switch away, and other sessions keep streaming while you're here.
  // Persistence is handled by the registry (on finish/error), not here.
  const [chat] = useState(() => getChat(threadId, seed));

  const { messages, sendMessage, regenerate, stop, status, error } = useChat({
    chat,
    experimental_throttle: 50,
  });

  const isRunning = status === "submitted" || status === "streaming";
  const saveFailed = useSaveFailed(threadId);

  // Mirror this thread's live status into the sidebar store. A stream only ever
  // starts while its thread is on screen, so the registry's finish/error
  // handlers are enough to clear it once the turn settles off-screen.
  useEffect(() => {
    setThreadStatus(threadId, status);
  }, [threadId, status]);

  const titleFromFirstMessage = useMutation(api.threads.titleFromFirstMessage);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendMessage({ text: trimmed });
      // Label the thread from its first question right away, not only once the
      // assistant replies (persistence otherwise happens on finish).
      void titleFromFirstMessage({ threadId, text: trimmed });
    },
    [sendMessage, titleFromFirstMessage, threadId],
  );

  // Resume the suspended SQL workflow with the user's clarification choices. The
  // answer renders as a user turn; the server ignores chat history on resume and
  // continues the run from its Postgres snapshot (see chat-registry transport).
  const resumeClarification = useCallback(
    (args: { runId: string; answers: { question: string; answer: string }[] }) => {
      const summary = args.answers
        .map((a) => a.answer)
        .filter(Boolean)
        .join("；");
      sendMessage({ text: summary || "（已确认）" }, { body: { resume: args } });
    },
    [sendMessage],
  );

  // Pause: the last assistant turn is a suspended workflow awaiting clarification.
  const last = messages[messages.length - 1];
  const awaitingClarify = Boolean(
    last?.role === "assistant" && last.parts.some((p) => getSuspendedClarify(p) !== null),
  );

  const isEmpty = messages.length === 0;
  // The most recent assistant message. A suspended clarify form renders there even
  // after the answer's user turn is appended, so a failed resume stays retryable —
  // the form reappears whenever no assistant response followed the suspend.
  const lastAssistantIndex = messages.reduce(
    (acc, message, idx) => (message.role === "assistant" ? idx : acc),
    -1,
  );
  const { scrollRef, onScroll, atBottom, scrollToBottom } = useAutoScroll(messages);

  return (
    <ChatActionsProvider value={{ sendMessage: send, resumeClarification, isRunning }}>
      <div
        className="aui-thread-root bg-background @container flex h-full flex-col"
        style={{
          ["--thread-max-width" as string]: "44rem",
          ["--composer-radius" as string]: "1.5rem",
          ["--composer-padding" as string]: "8px",
        }}
      >
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            "relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          {isEmpty && <ThreadWelcome />}

          <div className="mb-14 flex flex-col gap-y-6 empty:hidden">
            {messages.map((message, i) => {
              const isLast = i === messages.length - 1;
              if (message.role === "user")
                return <UserMessage key={message.id} message={message} />;
              return (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  running={isRunning && isLast}
                  isLastAssistant={i === lastAssistantIndex}
                  showActionBar={!(isLast && isRunning)}
                  regenerate={regenerate}
                />
              );
            })}
            {isRunning && last?.role === "user" && <StandaloneIndicator />}
          </div>

          <div
            className={cn(
              "bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto rounded-t-xl",
            )}
          >
            <div className="relative">
              {!atBottom && !isEmpty && (
                <TooltipIconButton
                  tooltip="滚动到底部"
                  variant="outline"
                  onClick={scrollToBottom}
                  className="dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full p-4"
                >
                  <ArrowDownIcon />
                </TooltipIconButton>
              )}
            </div>

            {error && (
              <div className="border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 rounded-md border p-3 text-sm dark:text-red-200">
                {error.message || "出错了，请重试。"}
              </div>
            )}

            {saveFailed && (
              <div className="border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 rounded-md border p-3 text-sm dark:text-red-200">
                最近一次回复未能保存，刷新后可能丢失。请稍后再发一条消息重试。
              </div>
            )}

            <Composer
              onSend={send}
              onStop={stop}
              isRunning={isRunning}
              disabled={awaitingClarify}
            />

            {isEmpty && <ThreadSuggestions onSend={send} />}
          </div>
        </div>
      </div>
    </ChatActionsProvider>
  );
};

/* ------------------------------------------------------------------ */
/* Auto-scroll                                                          */
/* ------------------------------------------------------------------ */

function useAutoScroll(dep: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = nearBottom;
    setAtBottom(nearBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.current = true;
    setAtBottom(true);
  }, []);

  return { scrollRef, onScroll, atBottom, scrollToBottom };
}

/* ------------------------------------------------------------------ */
/* Welcome + suggestions                                               */
/* ------------------------------------------------------------------ */

const ThreadWelcome: FC = () => {
  return (
    <div className="mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
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
      { label: "说明字段", prompt: "帮我说明一下数据库里的字段含义和表之间的关系。" },
      { label: "查找主外键", prompt: "帮我找出这个库里的主键和外键关系。" },
    ],
  },
  {
    label: "写查询",
    icon: <PencilLineIcon />,
    options: [
      { label: "写 SELECT", prompt: "根据我接下来要问的问题，帮我写一条 SQL 查询。" },
      { label: "关联多表", prompt: "帮我写一条 SQL，把最相关的几张表关联起来查询。" },
      { label: "筛选记录", prompt: "针对一个具体的业务问题，告诉我应该怎么筛选数据。" },
    ],
  },
  {
    label: "做分析",
    icon: <ChartColumnIcon />,
    options: [
      { label: "总结数据", prompt: "帮我总结这个数据库里最重要的数据特征和趋势。" },
      { label: "对比分组", prompt: "写一条 SQL，对比数据中几个重要分组的差异。" },
      { label: "发现异常", prompt: "帮我找出数据里的异常值或不太寻常的记录。" },
    ],
  },
  {
    label: "探索数据",
    icon: <CloudSunIcon />,
    options: [
      { label: "查看样例", prompt: "从最有用的几张表里，给我看一些简单的样例记录。" },
      { label: "统计行数", prompt: "统计每张表的行数，并帮我总结结果。" },
      { label: "检查质量", prompt: "检查数据库里的缺失值和其他数据质量问题。" },
    ],
  },
];

const suggestionChipClass =
  "text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors [&_svg]:size-4";

const ThreadSuggestions: FC<{ onSend: (text: string) => void }> = ({ onSend }) => {
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const expandedGroup = SUGGESTION_GROUPS.find((group) => group.label === expandedLabel);

  return (
    <div className="flex w-full flex-col gap-2 px-4">
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
                onClick={() => onSend(option.prompt)}
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

/* ------------------------------------------------------------------ */
/* Composer                                                             */
/* ------------------------------------------------------------------ */

const Composer: FC<{
  onSend: (text: string) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled: boolean;
}> = ({ onSend, onStop, isRunning, disabled }) => {
  const [value, setValue] = useState("");

  const submit = () => {
    if (isRunning || disabled) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="relative flex w-full flex-col gap-2">
      {disabled && (
        <p className="text-muted-foreground px-2 text-center text-xs">请先在上方完成选择</p>
      )}
      <div className="bg-background border-border/60 focus-within:border-border dark:border-muted-foreground/15 dark:bg-muted/30 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-3xl border p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] dark:shadow-none">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? "请先在上方完成选择…" : "发消息…"}
          disabled={disabled}
          rows={1}
          autoFocus
          aria-label="消息输入框"
          className="placeholder:text-muted-foreground/80 field-sizing-content max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-end">
          {isRunning ? (
            <Button
              type="button"
              size="icon"
              onClick={onStop}
              className="size-7 rounded-full"
              aria-label="停止生成"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={submit}
              disabled={disabled || !value.trim()}
              className="size-7 rounded-full"
              aria-label="发送消息"
            >
              <ArrowUpIcon className="size-4.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

const StandaloneIndicator: FC = () => (
  <div className="mx-auto w-full max-w-(--thread-max-width) px-2">
    <span
      className="text-muted-foreground inline-flex items-center gap-2 text-sm"
      aria-label="助手正在处理"
    >
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
    </span>
  </div>
);

const UserMessageImpl: FC<{ message: UIMessage }> = ({ message }) => {
  const text = messageText(message);
  return (
    <div className="fade-in slide-in-from-bottom-1 animate-in mx-auto flex w-full max-w-(--thread-max-width) justify-end px-2 duration-150">
      <div className="bg-muted text-foreground max-w-[85%] rounded-xl px-4 py-2 whitespace-pre-wrap wrap-break-word">
        {text}
      </div>
    </div>
  );
};

const UserMessage = memo(UserMessageImpl);

type AssistantMessageProps = {
  message: UIMessage;
  running: boolean;
  isLastAssistant: boolean;
  showActionBar: boolean;
  regenerate: (options?: { messageId?: string }) => void;
};

const AssistantMessageImpl: FC<AssistantMessageProps> = ({
  message,
  running,
  isLastAssistant,
  showActionBar,
  regenerate,
}) => {
  const parts = message.parts;

  // Clarification forms. New flow: a suspended `data-workflow` part renders the
  // interactive form while this is the latest assistant message — so it shows
  // when pending and reappears for retry if a resume failed (its user turn is
  // appended but no assistant response followed), yet hides once a resume turn
  // streams. Legacy: threads persisted before the workflow migration still carry
  // a clarify-request tool part, rendered read-only so old history keeps showing.
  const clarifyForms: ReactNode[] = [];
  let hasActiveClarify = false;
  parts.forEach((p, i) => {
    const suspended = getSuspendedClarify(p);
    if (suspended) {
      if (isLastAssistant) {
        hasActiveClarify = true;
        clarifyForms.push(
          <WorkflowClarifyForm
            key={`clarify-${i}`}
            runId={suspended.runId}
            questions={suspended.questions}
          />,
        );
      }
      return;
    }
    if (isToolUIPart(p) && isClarifyToolPart(p)) {
      clarifyForms.push(<ClarifyExchange key={`clarify-${i}`} part={p} />);
    }
  });

  // Last reasoning / non-clarify tool part: everything up to here is "thinking".
  let lastThinkingIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "reasoning" || (isToolUIPart(p) && !isClarifyToolPart(p))) {
      lastThinkingIndex = i;
      break;
    }
  }

  const groupChildren: ReactNode[] = [];
  const answer: ReactNode[] = [];
  let toolCount = 0;

  parts.forEach((p, i) => {
    if (isToolUIPart(p)) {
      if (isClarifyToolPart(p)) return; // rendered above as a legacy exchange
      toolCount++;
      groupChildren.push(<ToolPart key={i} part={p} />);
      return;
    }
    // On a suspend turn the form is the point — drop the model's prose; only the
    // grounding tool cards stay in the chain of thought.
    if (hasActiveClarify) return;
    if (p.type === "reasoning" && i <= lastThinkingIndex) {
      groupChildren.push(
        <ChainOfThoughtReasoning key={i}>
          <MarkdownText>{p.text}</MarkdownText>
        </ChainOfThoughtReasoning>,
      );
      return;
    }
    if (p.type === "text") {
      if (i <= lastThinkingIndex) {
        groupChildren.push(
          <ChainOfThoughtText key={i}>
            <MarkdownText>{p.text}</MarkdownText>
          </ChainOfThoughtText>,
        );
      } else {
        answer.push(<MarkdownText key={i}>{p.text}</MarkdownText>);
      }
    }
  });

  const showIndicator =
    running && groupChildren.length === 0 && clarifyForms.length === 0 && answer.length === 0;

  return (
    <div className="fade-in slide-in-from-bottom-1 animate-in mx-auto w-full max-w-(--thread-max-width) duration-150">
      <div className="text-foreground px-2 leading-relaxed wrap-break-word">
        {groupChildren.length > 0 && (
          <ChainOfThoughtGroup running={running} toolCount={toolCount}>
            {groupChildren}
          </ChainOfThoughtGroup>
        )}
        {clarifyForms}
        {answer}
        {showIndicator && (
          <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          </span>
        )}
      </div>

      {showActionBar && answer.length > 0 && (
        <div className="ms-2 flex items-center gap-1 pt-1.5">
          <AssistantActionBar
            text={messageText(message)}
            onRegenerate={() => regenerate({ messageId: message.id })}
          />
        </div>
      )}
    </div>
  );
};

const AssistantMessage = memo(AssistantMessageImpl);

const AssistantActionBar: FC<{ text: string; onRegenerate: () => void }> = ({
  text,
  onRegenerate,
}) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };

  return (
    <div className="text-muted-foreground flex gap-1">
      <TooltipIconButton tooltip="复制" onClick={copy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </TooltipIconButton>
      <TooltipIconButton tooltip="重新生成" onClick={onRegenerate}>
        <RefreshCwIcon />
      </TooltipIconButton>
    </div>
  );
};
