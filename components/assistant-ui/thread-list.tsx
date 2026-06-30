"use client";

import { useDeferredValue, useState, type FC } from "react";
import {
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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

  // Unfiltered list drives the "reuse an empty thread" guard — an untitled
  // empty thread has no searchable content, so it must not depend on the search.
  const allThreads = useQuery(api.threads.list) ?? [];

  const [search, setSearch] = useState("");
  // Defer the search term so each keystroke doesn't re-issue the query.
  const deferredSearch = useDeferredValue(search);
  const trimmedSearch = deferredSearch.trim();

  const results = useQuery(api.threads.browse, { search: trimmedSearch || undefined }) ?? [];

  const onNew = async () => {
    // Avoid piling up empty sessions: reuse an untouched thread (still the
    // default title and not mid-stream) instead of spawning another.
    const empty = allThreads.find(
      (t) => t.title === DEFAULT_THREAD_TITLE && !isThreadStreaming(t.id),
    );
    setCurrentId(empty ? empty.id : await createThread());
  };

  return (
    <div className="aui-thread-list-root flex flex-col gap-1">
      <Button
        variant="outline"
        onClick={() => void onNew()}
        className="hover:bg-muted h-9 justify-start gap-2 rounded-lg px-3 text-sm"
      >
        <PlusIcon className="size-4" />
        新建会话
      </Button>

      <div className="px-1 pt-2 pb-1">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话…"
            aria-label="搜索会话"
            className="h-8 ps-8 pe-7 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="清除搜索"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {trimmedSearch && results.length === 0 ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-sm">无匹配会话</p>
      ) : (
        results.map((thread) => (
          <ThreadListItem
            key={thread.id}
            id={thread.id}
            title={thread.title}
            pinned={thread.pinned}
          />
        ))
      )}
    </div>
  );
};

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
        "group flex h-9 items-center gap-2 rounded-lg transition-colors",
        active ? "bg-muted" : "hover:bg-muted",
      )}
    >
      <button
        type="button"
        onClick={() => setCurrentId(id)}
        className="flex h-full min-w-0 flex-1 items-center px-3 text-start text-sm"
      >
        {pinned && <PinIcon className="text-muted-foreground me-1.5 size-3.5 shrink-0" />}
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
              "me-2 size-7 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100",
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
        <DialogContent>
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
