"use client";

import { Button } from "@/components/ui/button";

const actions = [
  {
    label: "View services",
    message: "What services do you offer?",
  },
  {
    label: "Find a time",
    message: "Help me find an available time.",
  },
  {
    label: "Book an appointment",
    message: "I want to book an appointment.",
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
    <div className="flex flex-wrap gap-2">
      {actions.map(({ label, message }) => (
        <Button
          key={label}
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-full"
          disabled={disabled}
          onClick={() => onSelect(message)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
