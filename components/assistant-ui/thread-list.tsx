"use client";

import { useMemo, useState, type FC } from "react";
import {
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
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
import { DEFAULT_THREAD_TITLE, useChatStore } from "@/lib/chat-store";

export const ThreadList: FC = () => {
  const threads = useChatStore((s) => s.threads);
  const newThread = useChatStore((s) => s.newThread);

  // Pinned threads float to the top; sort is stable so order is otherwise kept.
  const ordered = useMemo(
    () => [...threads].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)),
    [threads],
  );

  return (
    <div className="aui-thread-list-root flex flex-col gap-1">
      <Button
        variant="outline"
        onClick={() => newThread()}
        className="hover:bg-muted h-9 justify-start gap-2 rounded-lg px-3 text-sm"
      >
        <PlusIcon className="size-4" />
        新建会话
      </Button>
      {ordered.map((thread) => (
        <ThreadListItem
          key={thread.id}
          id={thread.id}
          title={thread.title}
          pinned={thread.pinned}
        />
      ))}
    </div>
  );
};

const ThreadListItem: FC<{ id: string; title: string; pinned?: boolean }> = ({
  id,
  title,
  pinned,
}) => {
  const active = useChatStore((s) => s.currentId === id);
  const selectThread = useChatStore((s) => s.selectThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const togglePin = useChatStore((s) => s.togglePin);
  const renameThread = useChatStore((s) => s.renameThread);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const openRename = () => {
    setDraft(title?.trim() || DEFAULT_THREAD_TITLE);
    setRenameOpen(true);
  };

  const submitRename = () => {
    renameThread(id, draft);
    setRenameOpen(false);
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
        onClick={() => selectThread(id)}
        className="flex h-full min-w-0 flex-1 items-center px-3 text-start text-sm"
      >
        {pinned && <PinIcon className="text-muted-foreground me-1.5 size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{title?.trim() || DEFAULT_THREAD_TITLE}</span>
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
          <DropdownMenuItem onSelect={() => togglePin(id)}>
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
            <Button
              variant="destructive"
              onClick={() => {
                deleteThread(id);
                setDeleteOpen(false);
              }}
            >
              <TrashIcon className="size-4" />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
