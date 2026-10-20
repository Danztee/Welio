"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  HistoryIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

export type ReceptionistChatStatus =
  | "connecting"
  | "online"
  | "unavailable"
  | "preview";

const statusLabels: Record<ReceptionistChatStatus, string> = {
  connecting: "Connecting…",
  online: "Receptionist online",
  unavailable: "Receptionist unavailable",
  preview: "Preview",
};

const statusColors: Record<ReceptionistChatStatus, string> = {
  connecting: "bg-muted-foreground",
  online: "bg-success-foreground",
  unavailable: "bg-destructive",
  preview: "bg-primary",
};

export function ReceptionistConversationHeader({
  businessName,
  logo,
  status,
  hasCloseButton = false,
  conversationCount = 0,
  showingMessages = false,
  onMessages,
  onBack,
  onNewConversation,
  actionsDisabled = false,
}: {
  businessName: string;
  logo: string | null;
  status: ReceptionistChatStatus;
  hasCloseButton?: boolean;
  conversationCount?: number;
  showingMessages?: boolean;
  onMessages?: () => void;
  onBack?: () => void;
  onNewConversation?: () => void;
  actionsDisabled?: boolean;
}) {
  const closeButton = hasCloseButton && (
    <SheetClose
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close conversation"
        />
      }
    >
      <XIcon />
    </SheetClose>
  );

  return (
    <header className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3">
      {showingMessages ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to conversation"
            disabled={actionsDisabled}
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 font-semibold">Messages</p>
            <p className="truncate text-xs leading-4 text-muted-foreground">
              {businessName}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actionsDisabled}
            onClick={onNewConversation}
          >
            <PlusIcon data-icon="inline-start" />
            New
          </Button>
          {closeButton}
        </>
      ) : (
        <>
          <Avatar size="lg" className="rounded-xl after:rounded-xl">
            {logo && <AvatarImage src={logo} alt="" />}
            <AvatarFallback className="rounded-xl bg-primary/10 text-primary">
              <SparklesIcon className="size-4" aria-hidden="true" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-5 font-semibold">
              {businessName}
            </p>
            <p
              aria-live="polite"
              className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  statusColors[status],
                )}
              />
              {statusLabels[status]}
            </p>
          </div>
          {onMessages && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`View messages${conversationCount ? `, ${conversationCount} conversations` : ""}`}
              disabled={actionsDisabled}
              onClick={onMessages}
            >
              <HistoryIcon />
            </Button>
          )}
          {closeButton}
        </>
      )}
    </header>
  );
}
