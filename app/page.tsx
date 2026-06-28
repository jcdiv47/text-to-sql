"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { isSignedIn } = useAuth();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <MessagesSquare className="size-4" />
          </div>
          <span className="font-semibold">Text-to-SQL</span>
        </div>

        <div className="flex items-center gap-2">
          {isSignedIn ? (
            <UserButton />
          ) : (
            <>
              <SignInButton>
                <Button variant="ghost" size="sm" aria-label="登录">
                  登录
                </Button>
              </SignInButton>
              <SignUpButton>
                <Button variant="outline" size="sm" aria-label="注册">
                  注册
                </Button>
              </SignUpButton>
            </>
          )}
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-6">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">和你的数据库对话</h1>

          <p className="text-muted-foreground max-w-prose">
            用自然语言向 Text-to-SQL 智能体提问，查看 SQL 和数据结果。
          </p>

          <div className="mt-2">
            <Button asChild>
              <Link href="/chat" aria-label="开始聊天">
                开始聊天
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
