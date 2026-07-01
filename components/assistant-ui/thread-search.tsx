"use client";

import { useDeferredValue, useEffect, useState, type FC } from "react";
import { MessageSquareIcon, SearchIcon } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_THREAD_TITLE } from "@/lib/chat-constants";
import { useCurrentThread } from "@/lib/current-thread";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket a timestamp into a coarse relative label, like the search palettes
 *  in Claude/ChatGPT ("Yesterday", "Past week", …). */
const relativeDay = (ts: number): string => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "今天";
  if (ts >= startOfToday - DAY_MS) return "昨天";
  if (ts >= startOfToday - 7 * DAY_MS) return "过去一周";
  if (ts >= startOfToday - 30 * DAY_MS) return "过去一个月";
  return "更早";
};

/**
 * Search entry point for the sidebar header: a borderless icon button that
 * opens a centered command-palette modal. The modal runs its own full-text
 * search over message prose + SQL (not just titles) and selects on click.
 */
export const ThreadSearch: FC = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const setCurrentId = useCurrentThread((s) => s.setCurrentId);

  // Defer the term so each keystroke doesn't re-issue the query.
  const deferredSearch = useDeferredValue(search);
  const trimmedSearch = deferredSearch.trim();
  const results = useQuery(api.threads.browse, { search: trimmedSearch || undefined }) ?? [];

  // Start from the full list each time the modal reopens.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // ⌘K / Ctrl+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSelect = (id: Id<"threads">) => {
    setCurrentId(id);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="搜索会话"
        onClick={() => setOpen(true)}
      >
        <SearchIcon className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="bg-popover text-popover-foreground top-[24vh] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-2xl"
        >
          <DialogTitle className="sr-only">搜索会话</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3.5">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索会话…"
              aria-label="搜索会话"
              className="placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                {trimmedSearch ? "无匹配会话" : "暂无会话"}
              </p>
            ) : (
              results.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  className="hover:bg-muted flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-start"
                >
                  <MessageSquareIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {thread.title?.trim() || DEFAULT_THREAD_TITLE}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {relativeDay(thread.updatedAt)}
                      </span>
                    </div>
                    {thread.snippet && (
                      <p className="text-muted-foreground truncate text-xs">
                        {thread.snippet.before}
                        <span className="text-foreground font-medium">{thread.snippet.match}</span>
                        {thread.snippet.after}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
