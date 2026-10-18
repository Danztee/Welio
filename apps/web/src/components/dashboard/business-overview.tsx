"use client";

import dynamic from "next/dynamic";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@welio/ui/components/chart";
import { useState } from "react";
import Link from "next/link";
import {
  CalendarDaysIcon,
  ArrowUpRightIcon,
  ArrowRightIcon,
  SparklesIcon,
  CheckIcon,
  Clock3Icon,
} from "lucide-react";
import { Button } from "@welio/ui/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@welio/ui/components/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@welio/ui/components/native-select";
import { Badge } from "@welio/ui/components/badge";
import { Grid, Blank, Status } from "@/components/platform/shared";
import { dashboardPanelHeaderClassName } from "@/components/platform/panel-styles";

const Area = dynamic(() => import("recharts").then((module) => module.Area));
const AreaChart = dynamic(() =>
  import("recharts").then((module) => module.AreaChart),
);
const CartesianGrid = dynamic(() =>
  import("recharts").then((module) => module.CartesianGrid),
);
const XAxis = dynamic(() => import("recharts").then((module) => module.XAxis));
const YAxis = dynamic(() => import("recharts").then((module) => module.YAxis));

type Appointment = {
  id: string;
  customer: string;
  service: string;
  date: string;
  time: string;
  status: string;
};
function offsetDate(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);

  return date.toISOString().slice(0, 10);
}

export function BusinessOverview({
  appointments,
  customerCount,
  today,
  currency,
  receptionistHref,
  appointmentsHref,
  bookingHref,
  activity,
}: {
  appointments: Appointment[];
  customerCount: number;
  today: string;
  currency: string;
  receptionistHref: string;
  appointmentsHref: string;
  bookingHref?: string;
  activity: { id: string; title: string; date: string }[];
}) {
  const [period, setPeriod] = useState(7);
  const days = Array.from({ length: period }, (_, i) =>
    offsetDate(today, i - period + 1),
  );
  const counts = days.map(
    (date) =>
      appointments.filter((a) => a.date === date && a.status !== "Cancelled")
        .length,
  );
  const chartData = days.map((date, index) => ({
    date,
    bookings: counts[index],
  }));
  const todayBookings = appointments.filter(
    (a) => a.date === today && a.status !== "Cancelled",
  );
  const completed = appointments.filter((a) => a.status === "Completed").length;
  const active = appointments.filter(
    (a) => a.status === "Confirmed" || a.status === "Pending",
  ).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid min-w-0 items-stretch gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="overview-insights gap-0 py-0">
          <CardHeader
            className={`${dashboardPanelHeaderClassName} flex flex-wrap items-center justify-between gap-3 border-b`}
          >
            <CardTitle>Business insights</CardTitle>
            <Badge variant="outline">{currency}</Badge>
          </CardHeader>
          <CardContent className="px-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDaysIcon className="size-3.5" />
                Booking activity
              </div>
              <NativeSelect
                aria-label="Insights period"
                size="sm"
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
              >
                <NativeSelectOption value={7}>Last 7 days</NativeSelectOption>
                <NativeSelectOption value={30}>Last 30 days</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-6 px-6 pt-6 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Appointments today
                </p>
                <p className="mt-2 text-2xl font-medium tracking-tight tabular-nums sm:text-3xl">
                  {todayBookings.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Customers</p>
                <p className="mt-2 text-2xl font-medium tracking-tight tabular-nums sm:text-3xl">
                  {customerCount}
                </p>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs text-muted-foreground">
                  Confirmed bookings
                </p>
                <p className="mt-2 text-2xl font-medium tracking-tight tabular-nums sm:text-3xl">
                  {appointments.filter((a) => a.status === "Confirmed").length}
                </p>
              </div>
            </div>
            <div className="px-6 pt-6 pb-6">
              <ChartContainer
                config={{
                  bookings: { label: "Appointments", color: "var(--chart-1)" },
                }}
                className="aspect-auto h-48 w-full"
                role="img"
                aria-label={`Appointments per day for the last ${period} days: ${counts.join(", ")}`}
              >
                <AreaChart
                  accessibilityLayer
                  data={chartData}
                  margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                    tickFormatter={(value: string) => value.slice(5)}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={24}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="bookings"
                    type="linear"
                    fill="var(--color-bookings)"
                    fillOpacity={0.12}
                    stroke="var(--color-bookings)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
            <div className="grid grid-cols-2 border-t">
              <div className="flex items-start gap-3 border-r p-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-primary">
                  <CheckIcon className="size-4" />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="mt-1 text-xl font-medium tabular-nums">
                    {completed}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-primary">
                  <Clock3Icon className="size-4" />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Open appointments
                  </p>
                  <p className="mt-1 text-xl font-medium tabular-nums">
                    {active}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="receptionist-overview gap-0 py-0">
          <CardHeader
            className={`${dashboardPanelHeaderClassName} flex flex-wrap items-center justify-between gap-3 border-b`}
          >
            <CardTitle>Your AI receptionist</CardTitle>
            <SparklesIcon className="size-4 text-primary" />
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center gap-6 p-6">
            <div>
              <span className="mb-5 flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-accent text-primary">
                <SparklesIcon className="size-5" />
              </span>
              <h2 className="max-w-xs text-2xl leading-8 font-semibold tracking-tight">
                What would you like to get done today?
              </h2>
              <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
                Answer customer questions, check availability, and help them
                book an appointment.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                className="w-full justify-between"
                nativeButton={false}
                render={<Link href={receptionistHref} />}
              >
                Open AI receptionist
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                Review booking requests before approving them.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="gap-0 py-0">
          <CardHeader
            className={`${dashboardPanelHeaderClassName} flex flex-wrap items-center justify-between gap-3 border-b`}
          >
            <div>
              <CardTitle>Today’s appointments</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{today}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={appointmentsHref} />}
            >
              View all
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </CardHeader>
          <CardContent className="p-6">
            {todayBookings.length ? (
              <Grid
                rows={todayBookings.slice(0, 5)}
                columns={[
                  {
                    label: "Customer",
                    cell: (a) => (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{a.customer}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.service}
                        </span>
                      </div>
                    ),
                  },
                  { label: "Time", cell: (a) => a.time },
                  { label: "Status", cell: (a) => <Status value={a.status} /> },
                ]}
              />
            ) : (
              <Blank
                title="No appointments today"
                description="Bookings for today will appear here."
                action={
                  bookingHref ? (
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={bookingHref} />}
                    >
                      View booking page
                    </Button>
                  ) : undefined
                }
              />
            )}
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader
            className={`${dashboardPanelHeaderClassName} flex items-center border-b`}
          >
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <ul className="flex flex-col">
              {activity.slice(0, 4).map((item) => (
                <li
                  key={item.id}
                  className="flex gap-3 border-b py-3 first:pt-0 last:border-0 last:pb-0"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                  <div>
                    <p className="text-xs leading-5">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.date}
                    </p>
                  </div>
                </li>
              ))}
              {!activity.length && (
                <li className="py-6 text-sm text-muted-foreground">
                  Your latest booking updates will appear here.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
