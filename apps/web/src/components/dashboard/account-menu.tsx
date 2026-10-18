"use client";

import { ChevronRightIcon, LogOutIcon, UserRoundIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@welio/ui/components/avatar";
import { Button } from "@welio/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@welio/ui/components/dropdown-menu";

export function AccountMenu({
  name,
  email,
  onProfile,
  onSignOut,
}: {
  name: string;
  email: string;
  onProfile: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Account menu"
            className="h-10 w-full justify-start gap-3 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
          />
        }
      >
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="account-trigger-details min-w-0 flex-1 truncate text-left text-sm font-normal">
          {name.split(" ")[0]}
        </span>
        <ChevronRightIcon className="account-trigger-chevron" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-2rem)] p-0"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 px-3 py-3">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                {name}
              </span>
              <span className="text-xs leading-5 font-normal break-words text-muted-foreground">
                {email}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuGroup className="p-1">
          <DropdownMenuItem onClick={onProfile}>
            <UserRoundIcon />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onSignOut}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
