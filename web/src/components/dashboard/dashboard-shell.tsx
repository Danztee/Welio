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
import { useState, type CSSProperties, type ReactNode } from "react";
import { DashboardNavigation } from "./dashboard-navigation";
import { type NavigationItem } from "./dashboard-shell-types";
import { Spinner } from "@/components/ui/spinner";

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
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const visiblePendingSection =
    pendingSection === section ? null : pendingSection;

  return (
    <TooltipProvider>
      <SidebarProvider
        className="h-svh overflow-hidden"
        style={
          {
            "--sidebar-width": "14rem",
            "--sidebar-width-icon": "3.5rem",
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
            <DashboardNavigation
              section={section}
              navigation={navigation}
              onNavigate={(name) => {
                if (name !== section) setPendingSection(name);
              }}
            />
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
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
            {visiblePendingSection && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground backdrop-blur-[1px]"
                role="status"
                aria-label={`Loading ${visiblePendingSection}`}
              >
                <Spinner aria-hidden="true" />
                <span>Loading {visiblePendingSection}…</span>
              </div>
            )}
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
