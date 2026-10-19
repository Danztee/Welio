"use client";

import { CalendarDaysIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { useState } from "react";
import { scheduleAvailabilityMessage, staffWeek } from "./staff-schedule";

type Data = WorkspaceDashboardData;

export function StaffAvailabilityFields({
  worker,
  timeZone,
  isActive,
}: {
  worker?: Data["staff"][number];
  timeZone: string;
  isActive: boolean;
}) {
  const initialSchedule = worker?.schedule;
  const [days, setDays] = useState(initialSchedule?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(initialSchedule?.start ?? "09:00");
  const [end, setEnd] = useState(initialSchedule?.end ?? "17:00");
  const [breakStart, setBreakStart] = useState(
    initialSchedule?.breakStart ?? "",
  );
  const [breakEnd, setBreakEnd] = useState(initialSchedule?.breakEnd ?? "");
  const scheduleSummary = scheduleAvailabilityMessage({
    isActive,
    days,
    start,
    end,
    breakStart,
    breakEnd,
  });

  return (
    <Card className="gap-0 p-4 sm:p-5">
      <CardHeader className="grid-cols-[auto_1fr] gap-3 px-0 pt-0">
        <span className="row-span-2 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <CalendarDaysIcon aria-hidden className="size-4" />
        </span>
        <CardTitle className="text-sm font-semibold">
          <h3>Weekly booking hours</h3>
        </CardTitle>
        <CardDescription className="text-xs leading-5">
          One weekly schedule covers all services assigned in Services. Times
          use {timeZone}.
        </CardDescription>
      </CardHeader>

      <CardContent className="mt-5 px-0 pb-0">
        <FieldSet className="gap-2">
          <FieldLegend variant="label">Working days</FieldLegend>
          <ToggleGroup
            aria-label="Working days"
            className="grid w-full grid-cols-4 sm:grid-cols-7"
            multiple
            value={days.map(String)}
            onValueChange={(values) =>
              setDays(values.map(Number).sort((a, b) => a - b))
            }
          >
            {days.map((day) => (
              <input key={day} type="hidden" name="days" value={day} />
            ))}
            {staffWeek.map((day) => (
              <ToggleGroupItem
                key={day.value}
                aria-label={day.long}
                value={String(day.value)}
                variant="outline"
                size="sm"
                className="w-full rounded-lg px-1 text-xs aria-pressed:border-primary/45 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              >
                {day.short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>

        <FieldGroup className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="staff-start">Available from</FieldLabel>
            <Input
              id="staff-start"
              name="start"
              type="time"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="staff-end">Available until</FieldLabel>
            <Input
              id="staff-end"
              name="end"
              type="time"
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </Field>
        </FieldGroup>

        <Separator className="mt-4" />
        <div className="pt-4">
          <p className="mb-2 text-sm font-medium">Daily break (optional)</p>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel
                htmlFor="staff-break-start"
                className="text-xs text-muted-foreground"
              >
                Break starts
              </FieldLabel>
              <Input
                id="staff-break-start"
                name="breakStart"
                type="time"
                value={breakStart}
                onChange={(event) => setBreakStart(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel
                htmlFor="staff-break-end"
                className="text-xs text-muted-foreground"
              >
                Break ends
              </FieldLabel>
              <Input
                id="staff-break-end"
                name="breakEnd"
                type="time"
                value={breakEnd}
                onChange={(event) => setBreakEnd(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            This break is blocked on every selected working day.
          </p>
        </div>

        <p
          aria-live="polite"
          className="mt-4 text-xs leading-5 text-muted-foreground"
        >
          {scheduleSummary}
        </p>
      </CardContent>
    </Card>
  );
}
