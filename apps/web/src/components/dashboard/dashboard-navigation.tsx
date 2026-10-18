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
} from "@welio/ui/components/sidebar";
import type { NavigationItem } from "./dashboard-shell-types";

export function DashboardNavigation({
  section,
  navigation,
}: {
  section: string;
  navigation: NavigationItem[];
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <nav aria-label="Main navigation">
      {[navigation.slice(0, 5), navigation.slice(5)].map((items, index) => (
        <SidebarGroup key={index === 0 ? "primary" : "management"}>
          {index === 1 && <SidebarGroupLabel>Management</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
              {items.map(({ name, href, icon: Icon }) => (
                <SidebarMenuItem key={name}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={section === name}
                    aria-current={section === name ? "page" : undefined}
                    tooltip={name}
                    onClick={() => setOpenMobile(false)}
                    className="h-9 gap-3"
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
