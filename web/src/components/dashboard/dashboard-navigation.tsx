"use client";

import Link from "next/link";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import type { NavigationItem } from "./dashboard-shell-types";

export function DashboardNavigation({
  section,
  navigation,
  onNavigate,
}: {
  section: string;
  navigation: NavigationItem[];
  onNavigate: (name: string) => void;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <nav aria-label="Main navigation">
      {[navigation.slice(0, 5), navigation.slice(5)]
        .filter((items) => items.length > 0)
        .map((items, index) => (
          <SidebarGroup key={index === 0 ? "primary" : "management"}>
            {index === 1 && <SidebarGroupLabel>Management</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
                {items.map(({ name, href, icon: Icon }) => (
                  <SidebarMenuItem key={name}>
                    <SidebarMenuButton
                      render={
                        <Link
                          href={href}
                          onNavigate={() => onNavigate(name)}
                        />
                      }
                      isActive={section === name}
                      aria-current={section === name ? "page" : undefined}
                      tooltip={name}
                      onClick={() => setOpenMobile(false)}
                      className="h-11 gap-3 md:h-10"
                    >
                      <Icon aria-hidden="true" />
                      <span>{name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
    </nav>
  );
}
