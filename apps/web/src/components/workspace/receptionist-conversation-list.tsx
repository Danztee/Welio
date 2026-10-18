import type { ChatSummary } from "@welio/domain/receptionist/contract";
import { Avatar, AvatarFallback } from "@welio/ui/components/avatar";
import { Button } from "@welio/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@welio/ui/components/empty";
import { cn } from "@welio/ui/lib/utils";

function compactAge(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";

  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  return `${Math.floor(days / 365)}y`;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ReceptionistConversationList({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: ChatSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-card">
      {conversations.length ? (
        <ul aria-label="Conversations" className="divide-y divide-border">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Button
                type="button"
                variant="ghost"
                aria-current={conversation.id === activeId ? "true" : undefined}
                onClick={() => onSelect(conversation.id)}
                className={cn(
                  "h-auto w-full justify-start gap-3 rounded-none px-4 py-3.5 text-left whitespace-normal",
                  conversation.id === activeId && "bg-muted/35",
                )}
              >
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                    {initials(conversation.title) || "W"}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {conversation.title}
                    </span>
                    <time
                      dateTime={conversation.updatedAt}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {compactAge(conversation.updatedAt)}
                    </time>
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {conversation.preview}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="min-h-48 border-0">
          <EmptyHeader>
            <EmptyTitle>No conversations yet</EmptyTitle>
            <EmptyDescription>
              Start a conversation to get help with a booking.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
