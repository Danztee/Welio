"use client";

import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Brand } from "@/components/brand";
import type { CSSProperties, ReactNode } from "react";
import { DashboardNavigation } from "./dashboard-navigation";
import { type NavigationItem } from "./dashboard-shell-types";

export function DashboardShell({
  section,
  navigation,
  picker,
  accountMenu,
  headerActions,
  children,
}: {
  section: string;
  navigation: NavigationItem[];
  picker: ReactNode;
  accountMenu: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TooltipProvider>
      <SidebarProvider
        className="h-svh overflow-hidden"
        style={
          {
            "--sidebar-width": "15rem",
            "--sidebar-width-icon": "4.5rem",
          } as CSSProperties
        }
      >
        <a
          href="#dashboard-main"
          className="sr-only fixed top-3 left-3 z-50 rounded-lg bg-card p-3 text-sm focus:not-sr-only focus:outline-2 focus:outline-ring"
        >
          Skip to content
        </a>
        <Sidebar
          collapsible="icon"
          className="group-data-[side=left]:border-r-0"
        >
          <SidebarHeader className="h-17 shrink-0 justify-center px-4 group-data-[collapsible=icon]:px-2">
            {picker}
          </SidebarHeader>
          <SidebarContent>
            <DashboardNavigation section={section} navigation={navigation} />
          </SidebarContent>
          <SidebarFooter className="px-4 pb-5 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:[&_.account-trigger-chevron]:hidden group-data-[collapsible=icon]:[&_.account-trigger-details]:hidden">
            {accountMenu}
          </SidebarFooter>
        </Sidebar>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-17 shrink-0 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger />
              <div className="md:hidden">
                <Brand />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
            </div>
          </header>
          {children}
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
