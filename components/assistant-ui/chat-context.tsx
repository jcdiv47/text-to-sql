"use client";

import { createContext, useContext } from "react";

/**
 * Minimal bridge so deeply-nested message parts (e.g. the clarify form) can
 * drive the active `useChat` without prop drilling. Provided by `Thread`.
 */
export type ChatActions = {
  /** Sends a new user message into the current thread. */
  sendMessage: (text: string) => void;
  /** True while the assistant is streaming a response. */
  isRunning: boolean;
};

const ChatActionsContext = createContext<ChatActions | null>(null);

export const ChatActionsProvider = ChatActionsContext.Provider;

export function useChatActions(): ChatActions {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) {
    throw new Error("useChatActions must be used within a ChatActionsProvider");
  }
  return ctx;
}
