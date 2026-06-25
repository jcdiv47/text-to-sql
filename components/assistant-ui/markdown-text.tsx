"use client";

import { createElement, memo, useState, type ComponentPropsWithoutRef, type FC } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";

import { HighlightedSql } from "@/components/assistant-ui/sql-tools";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

/**
 * Markdown renderer for assistant text + reasoning. Replaces
 * `@assistant-ui/react-markdown` with plain `react-markdown` + `remark-gfm`.
 * Takes the part text as `children`. ```sql / ```postgres fenced blocks are
 * syntax-highlighted via {@link HighlightedSql}.
 */
const MarkdownTextImpl: FC<{ children: string }> = ({ children }) => {
  return (
    <div className="aui-md">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </Markdown>
    </div>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const useCopyToClipboard = ({ copiedDuration = 3000 }: { copiedDuration?: number } = {}) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = (value: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(
      () => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), copiedDuration);
      },
      () => {},
    );
  };

  return { isCopied, copyToClipboard };
};

const CodeHeader: FC<{ language: string; code: string }> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root border-border/50 bg-muted/50 mt-2.5 flex items-center justify-between rounded-t-lg border border-b-0 px-3 py-1.5 text-xs">
      <span className="aui-code-header-language text-muted-foreground font-medium lowercase">
        {language}
      </span>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {isCopied ? <CheckIcon /> : <CopyIcon />}
      </TooltipIconButton>
    </div>
  );
};

const SQL_LANGUAGES = new Set(["sql", "postgres", "postgresql"]);

const CodeBlock: FC<{ language: string; code: string }> = ({ language, code }) => {
  return (
    <figure className="aui-md-codeblock my-1.5">
      <CodeHeader language={language} code={code} />
      <pre className="aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-lg border border-t-0 p-3 text-xs leading-relaxed">
        <code className={`language-${language}`}>
          {SQL_LANGUAGES.has(language) ? <HighlightedSql sql={code} /> : code}
        </code>
      </pre>
    </figure>
  );
};

/** Tag renderer that merges a base class and strips react-markdown's `node`. */
function mdTag<Tag extends keyof React.JSX.IntrinsicElements>(tag: Tag, base: string) {
  return function MdTag({
    className,
    node,
    ...props
  }: ComponentPropsWithoutRef<Tag> & { node?: unknown }) {
    void node;
    return createElement(tag, { className: cn(base, className), ...props });
  };
}

const CodeRenderer = ({
  className,
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
  void node;
  const match = /language-(\w+)/.exec(className ?? "");

  if (match) {
    const code = String(children ?? "").replace(/\n$/, "");
    return <CodeBlock language={match[1].toLowerCase()} code={code} />;
  }

  return (
    <code
      className={cn(
        "aui-md-inline-code border-border/50 bg-muted/50 rounded-md border px-1.5 py-0.5 font-mono text-[0.85em]",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
};

const markdownComponents: Components = {
  h1: mdTag("h1", "aui-md-h1 mb-2 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0"),
  h2: mdTag("h2", "aui-md-h2 mt-3 mb-1.5 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0"),
  h3: mdTag("h3", "aui-md-h3 mt-2.5 mb-1 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0"),
  h4: mdTag("h4", "aui-md-h4 mt-2 mb-1 scroll-m-20 text-sm font-medium first:mt-0 last:mb-0"),
  h5: mdTag("h5", "aui-md-h5 mt-2 mb-1 text-sm font-medium first:mt-0 last:mb-0"),
  h6: mdTag("h6", "aui-md-h6 mt-2 mb-1 text-sm font-medium first:mt-0 last:mb-0"),
  p: mdTag("p", "aui-md-p my-2.5 leading-normal first:mt-0 last:mb-0"),
  a: mdTag("a", "aui-md-a text-primary hover:text-primary/80 underline underline-offset-2"),
  blockquote: mdTag(
    "blockquote",
    "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-2.5 border-s-2 ps-3 italic",
  ),
  ul: mdTag("ul", "aui-md-ul marker:text-muted-foreground my-2 ms-4 list-disc [&>li]:mt-1"),
  ol: mdTag("ol", "aui-md-ol marker:text-muted-foreground my-2 ms-4 list-decimal [&>li]:mt-1"),
  hr: mdTag("hr", "aui-md-hr border-muted-foreground/20 my-2"),
  table: mdTag(
    "table",
    "aui-md-table my-2 w-full border-separate border-spacing-0 overflow-y-auto",
  ),
  th: mdTag(
    "th",
    "aui-md-th bg-muted px-2 py-1 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
  ),
  td: mdTag(
    "td",
    "aui-md-td border-muted-foreground/20 border-s border-b px-2 py-1 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
  ),
  tr: mdTag(
    "tr",
    "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
  ),
  li: mdTag("li", "aui-md-li leading-normal"),
  sup: mdTag("sup", "aui-md-sup [&>a]:text-xs [&>a]:no-underline"),
  pre: ({ children }) => <>{children}</>,
  code: CodeRenderer,
};
