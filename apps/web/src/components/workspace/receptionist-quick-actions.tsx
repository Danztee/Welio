"use client";

import { Button } from "@welio/ui/components/button";
import { CalendarClockIcon, CalendarPlusIcon, ListIcon } from "lucide-react";

const actions = [
  {
    label: "View services",
    message: "What services do you offer?",
    icon: ListIcon,
  },
  {
    label: "Find a time",
    message: "Help me find an available time.",
    icon: CalendarClockIcon,
  },
  {
    label: "Book",
    message: "I want to book an appointment.",
    icon: CalendarPlusIcon,
  },
] as const;

export function ReceptionistQuickActions({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (message: string) => void;
}) {
  return (
    <div className="ml-9 flex flex-col gap-2">
      <p className="px-1 text-xs text-muted-foreground">Quick actions</p>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ label, message, icon: Icon }) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(message)}
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
