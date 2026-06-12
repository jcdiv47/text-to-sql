"use client";

import { useMemo, type FC } from "react";
import { AssistantCloud, AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { ShareIcon } from "lucide-react";
import { useAuth, UserButton } from "@clerk/nextjs";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const ThreadTitle: FC = () => {
  const title = useAuiState(
    (s) => s.threads.threadItems.find((t) => t.id === s.threads.mainThreadId)?.title,
  );

  return (
    <span className="min-w-0 truncate text-sm font-medium">{title?.trim() || "New Chat"}</span>
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
          tooltip="Share"
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
  const { getToken } = useAuth();

  const cloud = useMemo(
    () =>
      new AssistantCloud({
        baseUrl: process.env.NEXT_PUBLIC_ASSISTANT_BASE_URL!,
        authToken: async () => {
          const token = await getToken({ template: "assistant-ui" });

          if (!token) throw new Error("Missing Clerk JWT");

          return token;
        },
      }),
    [getToken],
  );

  const runtime = useChatRuntime({
    cloud,
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SidebarProvider className="bg-muted/30 h-full min-h-0">
        <ThreadListSidebar />
        <SidebarInset className="bg-muted/30 min-h-0 overflow-hidden p-2">
          <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-lg">
            <Header />
            <main className="flex-1 overflow-hidden">
              <Thread />
            </main>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AssistantRuntimeProvider>
  );
};
