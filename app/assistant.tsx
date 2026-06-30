"use client";

import { useEffect, useRef, type FC } from "react";
import { ShareIcon } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DEFAULT_THREAD_TITLE } from "@/lib/chat-constants";
import { useCurrentThread } from "@/lib/current-thread";

const ThreadTitle: FC = () => {
  const currentId = useCurrentThread((s) => s.currentId);
  const threads = useQuery(api.threads.list);
  const title = threads?.find((t) => t.id === currentId)?.title;

  return (
    <span className="min-w-0 truncate text-sm font-medium">
      {title?.trim() || DEFAULT_THREAD_TITLE}
    </span>
  );
};

const Header: FC = () => {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4">
      <SidebarTrigger className="size-8 shrink-0" />
      <ThreadTitle />
      <div className="ml-auto flex items-center gap-2">
        <TooltipIconButton
          variant="ghost"
          size="icon"
          tooltip="分享"
          side="bottom"
          disabled
          className="size-8"
        >
          <ShareIcon className="size-4" />
        </TooltipIconButton>
        <UserButton />
      </div>
    </header>
  );
};

export const Assistant = () => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const threads = useQuery(api.threads.list, isAuthenticated ? {} : "skip");
  const currentId = useCurrentThread((s) => s.currentId);
  const setCurrentId = useCurrentThread((s) => s.setCurrentId);
  const createThread = useMutation(api.threads.create);
  const creating = useRef(false);

  // Once threads load, guarantee a valid current thread: keep the selection if
  // it still exists, otherwise open the most recent, or create one if there are
  // none. The ref guards against a double create under React strict mode.
  useEffect(() => {
    if (!threads) return;
    if (currentId && threads.some((t) => t.id === currentId)) return;
    if (threads.length > 0) {
      setCurrentId(threads[0].id);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    void createThread().then((id) => {
      setCurrentId(id);
      creating.current = false;
    });
  }, [threads, currentId, setCurrentId, createThread]);

  const current = threads?.find((t) => t.id === currentId);

  // Neutral placeholder until Convex auth resolves, threads load, and a valid
  // current thread exists (also covers the brief window right after a delete).
  if (isLoading || !threads || !current) {
    return <div className="bg-sidebar h-full" />;
  }

  return (
    <SidebarProvider className="h-full min-h-0">
      <ThreadListSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Thread key={current.id} threadId={current.id} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
