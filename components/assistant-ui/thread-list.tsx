"use client";

import { useState, type FC, type ReactNode } from "react";
import {
  ChevronRightIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEFAULT_THREAD_TITLE } from "@/lib/chat-constants";
import { disposeChat } from "@/lib/chat-registry";
import { isThreadStreaming, useThreadStatus } from "@/lib/chat-status";
import { useCurrentThread } from "@/lib/current-thread";

export const ThreadList: FC = () => {
  const createThread = useMutation(api.threads.create);
  const setCurrentId = useCurrentThread((s) => s.setCurrentId);

  // Pinned first, then most-recently-updated. Also drives the "reuse an empty
  // thread" guard below.
  const threads = useQuery(api.threads.list) ?? [];

  const onNew = async () => {
    // Avoid piling up empty sessions: reuse an untouched thread (still the
    // default title and not mid-stream) instead of spawning another.
    const empty = threads.find((t) => t.title === DEFAULT_THREAD_TITLE && !isThreadStreaming(t.id));
    setCurrentId(empty ? empty.id : await createThread());
  };

  const pinned = threads.filter((t) => t.pinned);
  const recent = threads.filter((t) => !t.pinned);

  return (
    <div className="aui-thread-list-root flex flex-col gap-1">
      <Button
        variant="ghost"
        onClick={() => void onNew()}
        className="hover:bg-muted h-9 justify-start gap-2 rounded-lg px-3 text-sm"
      >
        <PlusIcon className="size-4" />
        新建会话
      </Button>

      {pinned.length > 0 && (
        <ThreadListSection label="置顶会话">
          {pinned.map((thread) => (
            <ThreadListItem
              key={thread.id}
              id={thread.id}
              title={thread.title}
              pinned={thread.pinned}
            />
          ))}
        </ThreadListSection>
      )}

      {recent.length > 0 && (
        <ThreadListSection label="最近会话">
          {recent.map((thread) => (
            <ThreadListItem
              key={thread.id}
              id={thread.id}
              title={thread.title}
              pinned={thread.pinned}
            />
          ))}
        </ThreadListSection>
      )}
    </div>
  );
};

const ThreadListSection: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <Collapsible defaultOpen className="group/section">
    <CollapsibleTrigger className="group/header text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-3 pt-5 pb-2 text-sm font-medium">
      {label}
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0 transition-[transform,opacity]",
          "group-data-[state=open]/section:rotate-90",
          // Always visible when collapsed; only on hover when expanded.
          "opacity-0 group-data-[state=closed]/section:opacity-100 group-hover/header:opacity-100",
        )}
      />
    </CollapsibleTrigger>
    <CollapsibleContent className="flex flex-col gap-1">{children}</CollapsibleContent>
  </Collapsible>
);

const ThreadListItem: FC<{ id: Id<"threads">; title: string; pinned: boolean }> = ({
  id,
  title,
  pinned,
}) => {
  const currentId = useCurrentThread((s) => s.currentId);
  const setCurrentId = useCurrentThread((s) => s.setCurrentId);
  const active = currentId === id;
  const rename = useMutation(api.threads.rename);
  const togglePin = useMutation(api.threads.togglePin);
  const remove = useMutation(api.threads.remove);
  const status = useThreadStatus(id);
  const running = status === "submitted" || status === "streaming";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const openRename = () => {
    setDraft(title?.trim() || DEFAULT_THREAD_TITLE);
    setRenameOpen(true);
  };

  const submitRename = () => {
    void rename({ threadId: id, title: draft });
    setRenameOpen(false);
  };

  const onDelete = () => {
    disposeChat(id);
    // Hand selection back to the placeholder; the assistant picks the next
    // thread (or creates one) once the deletion lands in the list query.
    if (active) setCurrentId(null);
    void remove({ threadId: id });
    setDeleteOpen(false);
  };

  return (
    <div
      className={cn(
        "group/item flex h-9 items-center gap-2 rounded-lg transition-colors",
        active ? "bg-muted" : "hover:bg-muted",
      )}
    >
      <button
        type="button"
        onClick={() => setCurrentId(id)}
        className="flex h-full min-w-0 flex-1 items-center px-3 text-start text-sm"
      >
        <span className="min-w-0 flex-1 truncate">{title?.trim() || DEFAULT_THREAD_TITLE}</span>
        {running && (
          <LoaderCircleIcon
            className="text-muted-foreground ms-1.5 size-3.5 shrink-0 animate-spin"
            aria-label="生成中"
          />
        )}
      </button>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "me-2 size-7 shrink-0 p-0 opacity-0 transition-opacity group-hover/item:opacity-100",
              (active || menuOpen) && "opacity-100",
            )}
            aria-label="会话菜单"
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => void togglePin({ threadId: id })}>
            {pinned ? <PinOffIcon /> : <PinIcon />}
            {pinned ? "取消置顶" : "置顶会话"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openRename}>
            <PencilIcon />
            重命名会话
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <TrashIcon />
            删除会话
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent aria-describedby={undefined}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名会话</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={draft}
              maxLength={100}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              aria-label="会话名称"
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!draft.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除该会话？</DialogTitle>
            <DialogDescription>这将永久删除该会话及其消息，且无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={onDelete}>
              <TrashIcon className="size-4" />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
