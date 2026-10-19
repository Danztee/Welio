"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/platform/search-field";

type Workspace = { id: string; name: string };
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  activeLogo,
  onSwitch,
  createHref,
}: {
  workspaces: Workspace[];
  activeId: string;
  activeLogo: string | null;
  onSwitch: (id: string) => void;
  createHref: string;
}) {
  const [search, setSearch] = useState("");
  const active = workspaces.find((w) => w.id === activeId);

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setSearch("");
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label="Switch workspace"
              className="h-12 w-full min-w-0 justify-start gap-2.5 px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            />
          }
        >
          <Avatar>
            {activeLogo && (
              <AvatarImage src={activeLogo} alt="" className="object-contain" />
            )}
            <AvatarFallback>
              {active?.name.charAt(0).toUpperCase() ?? "W"}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col gap-1 text-left group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">
              {active?.name ?? "Your workspace"}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Business workspace
            </span>
          </span>
          <ChevronsUpDownIcon
            data-icon="inline-end"
            aria-hidden="true"
            className="group-data-[collapsible=icon]:hidden"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72 max-w-[calc(100vw-2rem)] p-0"
        >
          <div
            className="border-b p-4"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <SearchField
              label="Search workspaces"
              value={search}
              onChange={setSearch}
            />
          </div>
          <DropdownMenuGroup className="p-2">
            <DropdownMenuLabel className="px-2 py-2">
              Workspaces
            </DropdownMenuLabel>
            {workspaces
              .filter((w) =>
                w.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((w) => (
                <DropdownMenuItem key={w.id} onClick={() => onSwitch(w.id)}>
                  <Avatar size="sm">
                    <AvatarFallback>
                      {w.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === activeId && (
                    <CheckIcon aria-label="Current workspace" />
                  )}
                </DropdownMenuItem>
              ))}
            {!workspaces.some((w) =>
              w.name.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No matching workspaces.
              </p>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="m-0" />
          <DropdownMenuGroup className="p-2">
            <DropdownMenuItem render={<Link href={createHref} />}>
              <PlusIcon />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
