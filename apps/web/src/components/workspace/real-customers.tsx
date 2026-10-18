"use client";
import { Blank, Grid, Status } from "@/components/platform/shared";
import { SearchField } from "@/components/platform/search-field";
import { Badge } from "@welio/ui/components/badge";
import { Button } from "@welio/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@welio/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@welio/ui/components/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@welio/ui/components/sheet";
import { Separator } from "@welio/ui/components/separator";
import { floatingSheetClassName } from "@welio/ui/components/sheet-styles";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { EyeIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { formatWhen, formatMoney } from "./booking-format";

type Data = WorkspaceDashboardData;

export function RealCustomers({ data }: { data: Data }) {
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const customer = data.customers.find((c) => c.id === selected);
  const appointments = customer
    ? data.bookings.filter(
        (appointment) => appointment.customerId === customer.id,
      )
    : [];

  return (
    <>
      <Grid
        toolbar={
          <SearchField
            label="Search customers"
            value={query}
            onChange={setQuery}
          />
        }
        empty={
          data.customers.length ? "No customers found" : "No customers yet"
        }
        emptyDescription={
          data.customers.length
            ? "Try a different search."
            : "Customers will appear here when they book an appointment."
        }
        rows={data.customers.filter((customer) =>
          `${customer.name} ${customer.email ?? ""} ${customer.phone ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )}
        columns={[
          {
            label: "Customer",
            cell: (c) => c.name,
          },
          { label: "Email", cell: (c) => c.email ?? "—" },
          { label: "Phone", cell: (c) => c.phone ?? "—" },
          {
            label: "Appointments",
            cell: (c) =>
              data.bookings.filter(
                (appointment) => appointment.customerId === c.id,
              ).length,
          },
          {
            label: "Actions",
            cell: (c) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${c.name}`}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setSelected(c.id)}>
                      <EyeIcon />
                      View details
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />
      <Sheet
        open={Boolean(customer)}
        onOpenChange={(open) => {
          if (!open) setSelected("");
        }}
      >
        {customer && (
          <SheetContent side="right" className={floatingSheetClassName}>
            <SheetHeader className="px-4 py-4 pr-12">
              <SheetTitle>{customer.name}</SheetTitle>
              <SheetDescription className="break-words">
                {customer.email || "No email added"} ·{" "}
                {customer.phone || "No phone added"}
              </SheetDescription>
            </SheetHeader>
            <Separator />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <section className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Appointments</h3>
                  <Badge variant="outline" tone="neutral">
                    {appointments.length}
                  </Badge>
                </div>
                {appointments.length ? (
                  <div className="flex flex-col gap-3">
                    {appointments.map((appointment) => {
                      const staffName = data.staff.find(
                        (member) => member.id === appointment.staffId,
                      )?.name;

                      return (
                        <Card key={appointment.id} className="gap-0 py-0">
                          <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3 p-4">
                            <div className="min-w-0">
                              <CardTitle className="truncate text-sm">
                                {appointment.serviceName}
                              </CardTitle>
                              <CardDescription className="mt-1 text-xs">
                                {formatWhen(
                                  appointment.startsAt,
                                  appointment.timeZone,
                                )}
                              </CardDescription>
                            </div>
                            <Status value={appointment.status} />
                          </CardHeader>
                          <Separator />
                          <CardContent className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-2">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Booked as
                              </p>
                              <p className="mt-1 break-words">
                                {appointment.customerName || customer.name}
                              </p>
                            </div>
                            {staffName && (
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  Team member
                                </p>
                                <p className="mt-1 break-words">{staffName}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Price
                              </p>
                              <p className="mt-1">
                                {formatMoney(
                                  appointment.priceMinor,
                                  appointment.currency,
                                )}
                              </p>
                            </div>
                            {appointment.serviceAddress && (
                              <div className="sm:col-span-2">
                                <p className="text-xs text-muted-foreground">
                                  Address
                                </p>
                                <p className="mt-1 break-words">
                                  {appointment.serviceAddress}
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <Blank
                    title="No appointments yet"
                    description="This customer hasn’t booked an appointment yet."
                  />
                )}
              </section>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}
