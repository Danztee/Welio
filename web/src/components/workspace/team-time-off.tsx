"use client";
import {
  removeTimeOffAction,
  saveTimeOffAction,
} from "@/app/dashboard/booking-actions";
import { text } from "@/components/platform/form-utils";
import { Confirm, Editor, Grid, Heading } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Data = WorkspaceDashboardData;
const timeOffDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatDate(date: string) {
  return timeOffDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

async function save(
  action: typeof saveTimeOffAction,
  workspaceId: string,
  input: unknown,
) {
  const result = await runServerAction(() => action(workspaceId, input));
  if (!result.ok) throw Error(result.error);

  return result;
}

export function TeamTimeOff({ data }: { data: Data }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false),
    [remove, setRemove] = useState("");

  return (
    <>
      <div className="flex flex-col gap-6">
        <Heading
          title="Time off"
          action={
            <Button
              disabled={!data.staff.length}
              onClick={() => setAdding(true)}
            >
              <PlusIcon data-icon="inline-start" />
              Add time off
            </Button>
          }
        />
        <Grid
          rows={data.timeOff}
          empty="No time off scheduled"
          emptyDescription={
            data.staff.length
              ? "Add time off to block bookings when a team member is away."
              : "Add a team member before scheduling time off."
          }
          columns={[
            {
              label: "Staff",
              cell: (l) =>
                data.staff.find((s) => s.id === l.staffId)?.name ?? "—",
            },
            { label: "From", cell: (l) => formatDate(l.from) },
            { label: "To", cell: (l) => formatDate(l.to) },
            { label: "Reason", cell: (l) => l.reason },
            {
              label: "Actions",
              cell: (l) => (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Time off actions"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setRemove(l.id)}
                      >
                        <Trash2Icon />
                        Remove time off
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
        />
      </div>
      {adding && (
        <Editor
          title="Add time off"
          description="These full dates are blocked in the business time zone. Reschedule conflicting appointments first."
          fields={[
            {
              name: "staffId",
              label: "Staff member",
              type: "select",
              required: true,
              options: [
                { value: "", label: "Select a team member" },
                ...data.staff.map((t) => ({ value: t.id, label: t.name })),
              ],
            },
            { name: "from", label: "From", type: "date", required: true },
            { name: "to", label: "To", type: "date", required: true },
            {
              name: "reason",
              label: "Internal reason",
              type: "textarea",
              required: true,
              maxLength: 200,
              value: "Time off",
            },
          ]}
          onClose={() => setAdding(false)}
          onSave={async (f) => {
            await save(saveTimeOffAction, data.workspace.id, {
              staffId: text(f, "staffId"),
              from: text(f, "from"),
              to: text(f, "to"),
              reason: text(f, "reason"),
            });
            router.refresh();
          }}
        />
      )}
      {remove && (
        <Confirm
          title="Remove time off?"
          label="Remove"
          variant="destructive"
          onClose={() => setRemove("")}
          onConfirm={async () => {
            await save(removeTimeOffAction, data.workspace.id, remove);
            router.refresh();
          }}
        >
          This team member will become available on these dates, subject to
          their working hours and bookings.
        </Confirm>
      )}
    </>
  );
}
