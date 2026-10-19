"use client";
import { retryBookingEmailAction } from "@/app/dashboard/booking-actions";
import { Confirm, Grid, Status } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { MoreHorizontalIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Data = WorkspaceDashboardData;
async function save(workspaceId: string, input: unknown) {
  const result = await runServerAction(() =>
    retryBookingEmailAction(workspaceId, input),
  );
  if (!result.ok) throw Error(result.error);

  return result;
}

export function BookingNotifications({ data }: { data: Data }) {
  const router = useRouter();
  const [retry, setRetry] = useState("");
  const [status, setStatus] = useState("all");

  return (
    <div className="flex flex-col gap-6">
      <Grid
        searchText={(notification) =>
          [
            notification.subject,
            notification.recipient,
            notification.kind === "reminder" ? "Reminder" : "Booking update",
            notification.status,
            notification.attempts,
          ].join(" ")
        }
        empty={
          data.notifications.length
            ? "No notifications found"
            : "No notifications yet"
        }
        emptyDescription={
          data.notifications.length
            ? "Try another status."
            : "Booking emails will appear here when they’re sent."
        }
        toolbar={
          <NativeSelect
            aria-label="Notification status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {["all", "queued", "sending", "sent", "failed", "skipped"].map(
              (value) => (
                <NativeSelectOption key={value} value={value}>
                  {value === "all"
                    ? "All statuses"
                    : value.charAt(0).toUpperCase() + value.slice(1)}
                </NativeSelectOption>
              ),
            )}
          </NativeSelect>
        }
        rows={data.notifications
          .filter(
            (notification) =>
              status === "all" || notification.status === status,
          )
          .slice()
          .reverse()}
        columns={[
          { label: "Email", cell: (n) => n.subject },
          {
            label: "Type",
            cell: (n) =>
              n.kind === "reminder" ? "Reminder" : "Booking update",
          },
          { label: "Recipient", cell: (n) => n.recipient },
          { label: "Status", cell: (n) => <Status value={n.status} /> },
          { label: "Attempts", cell: (n) => n.attempts },
          {
            label: "Actions",
            cell: (n) =>
              ["failed", "sending"].includes(n.status) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Notification actions"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => setRetry(n.id)}>
                        <RotateCcwIcon />
                        Retry delivery
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                "—"
              ),
          },
        ]}
      />
      {retry && (
        <Confirm
          title="Retry this email?"
          label="Retry delivery"
          onClose={() => setRetry("")}
          onConfirm={async () => {
            await save(data.workspace.id, retry);
            router.refresh();
          }}
        >
          A failed message will be requeued. A send interrupted after provider
          acceptance may already have arrived; retrying can duplicate it.
          Sending messages can be recovered after 10 minutes.
        </Confirm>
      )}
    </div>
  );
}
