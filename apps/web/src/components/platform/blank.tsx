import { InboxIcon } from "lucide-react";
import { ReactNode } from "react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
  EmptyTitle,
} from "@welio/ui/components/empty";

export function Blank({
  title = "Nothing here yet",
  description = "Add your first record to get started.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Empty className="min-h-48">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
