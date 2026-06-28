"use client";

import { useEffect, useState, type FC } from "react";
import { ShareIcon } from "lucide-react";
import { UserButton, useAuth } from "@clerk/nextjs";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { chatUserKey, DEFAULT_THREAD_TITLE, setChatUser, useChatStore } from "@/lib/chat-store";

const ThreadTitle: FC = () => {
  const title = useChatStore((s) => s.threads.find((t) => t.id === s.currentId)?.title);

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
  const { isLoaded, userId } = useAuth();
  const currentId = useChatStore((s) => s.currentId);
  const newThread = useChatStore((s) => s.newThread);
  const [hydratedUserKey, setHydratedUserKey] = useState<string | null>(null);

  // Point the persisted (client-only) store at the signed-in user's namespace
  // before any thread is read or created, so conversations never leak across
  // Clerk accounts on a shared device. Re-runs whenever the user changes.
  useEffect(() => {
    if (!isLoaded) return;
    setChatUser(userId);
    setHydratedUserKey(chatUserKey(userId));
  }, [isLoaded, userId]);

  // Ready only once the store has been rehydrated for *this* user. On an account
  // switch React first re-renders with the new userId but the previous user's
  // store; gating on the key (not a bare boolean) holds the placeholder for that
  // frame instead of flashing the previous user's conversations.
  const ready = hydratedUserKey === chatUserKey(userId);

  // Once this user's threads are loaded, guarantee an active thread exists.
  useEffect(() => {
    if (ready && !currentId) newThread();
  }, [ready, currentId, newThread]);

  if (!ready || !currentId) {
    return <div className="bg-sidebar h-full" />;
  }

  return (
    <SidebarProvider className="h-full min-h-0">
      <ThreadListSidebar variant="inset" />
      <SidebarInset className="min-h-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Thread key={currentId} threadId={currentId} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
