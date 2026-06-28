"use client";

import { useState, type FC } from "react";
import { PlusIcon, TrashIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { DEFAULT_THREAD_TITLE, useChatStore } from "@/lib/chat-store";

export const ThreadList: FC = () => {
  const threads = useChatStore((s) => s.threads);
  const newThread = useChatStore((s) => s.newThread);

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
      {threads.map((thread) => (
        <ThreadListItem key={thread.id} id={thread.id} title={thread.title} />
      ))}
    </div>
  );
};

const ThreadListItem: FC<{ id: string; title: string }> = ({ id, title }) => {
  const active = useChatStore((s) => s.currentId === id);
  const selectThread = useChatStore((s) => s.selectThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        <span className="min-w-0 flex-1 truncate">{title?.trim() || DEFAULT_THREAD_TITLE}</span>
      </button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeleteOpen(true)}
          className={cn(
            "me-2 size-7 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100",
            active && "opacity-100",
          )}
          aria-label="删除会话"
        >
          <TrashIcon className="size-4" />
        </Button>
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
