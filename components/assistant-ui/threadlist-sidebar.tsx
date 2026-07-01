import type * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { ThreadSearch } from "@/components/assistant-ui/thread-search";

export function ThreadListSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader className="aui-sidebar-header px-3 pt-3 pb-4">
        <div className="aui-sidebar-header-content flex items-center justify-between">
          <span className="aui-sidebar-header-title text-lg font-semibold tracking-tight">
            Text-to-SQL
          </span>
          <div className="aui-sidebar-header-actions flex items-center gap-0.5">
            <ThreadSearch />
            <SidebarTrigger className="size-8" />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="aui-sidebar-content px-2">
        <ThreadList />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
