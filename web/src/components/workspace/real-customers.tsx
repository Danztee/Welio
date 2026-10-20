"use client";
import { Blank, Grid, Status } from "@/components/platform/shared";
import { ListPagination } from "./list-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { floatingSheetClassName } from "@/components/ui/sheet-styles";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { EyeIcon, MoreHorizontalIcon } from "lucide-react";
import { customerAppointments } from "@/app/dashboard/read-actions";
import { useEffect, useState } from "react";
import { formatWhen, formatMoney } from "./booking-format";

type Data = WorkspaceDashboardData;

export function RealCustomers({
  data,
  searchQuery,
}: {
  data: Data;
  searchQuery: string;
}) {
  const [selected, setSelected] = useState("");
  const customer = data.customers.find((c) => c.id === selected);
  const [history, setHistory] = useState<{
    id: string;
    items: Data["bookings"];
    nextCursor: string;
  } | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const appointments = history?.id === selected ? history.items : [];
  useEffect(() => {
    if (!selected) return;
    let active = true;
    customerAppointments(data.workspace.id, selected)
      .then((page) => {
        if (active) {
          setHistory({
            id: selected,
            items: page.items,
            nextCursor: page.nextCursor,
          });
          setHistoryError(false);
        }
      })
      .catch(() => {
        if (active) setHistoryError(true);
      });
    return () => {
      active = false;
    };
  }, [selected, data.workspace.id]);
  async function loadMoreHistory() {
    if (!history || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const page = await customerAppointments(
        data.workspace.id,
        selected,
        history.nextCursor,
      );
      setHistory((current) =>
        current?.id === selected
          ? {
              id: selected,
              items: [...current.items, ...page.items],
              nextCursor: page.nextCursor,
            }
          : current,
      );
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <>
      <Grid
        externalSearch
        searchQuery={searchQuery}
        footer={<ListPagination data={data} section="Customers" />}
        empty={
          data.pagination?.search || data.customers.length
            ? "No customers found"
            : "No customers yet"
        }
        emptyDescription={
          data.customers.length
            ? "Try a different search."
            : "Customers will appear here when they book an appointment."
        }
        rows={data.customers}
        columns={[
          {
            label: "Customer",
            cell: (c) => c.name,
          },
          { label: "Email", cell: (c) => c.email ?? "—" },
          { label: "Phone", cell: (c) => c.phone ?? "—" },
          {
            label: "Appointments",
            cell: (c) => c.appointmentCount,
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
            <SheetHeader>
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
                    {customer.appointmentCount}
                  </Badge>
                </div>
                {historyError ? (
                  <p role="alert">
                    Could not load appointment history. Close and reopen details
                    to try again.
                  </p>
                ) : history?.id !== selected ? (
                  <p
                    role="status"
                    className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
                  >
                    <Spinner aria-hidden="true" />
                    Loading appointments…
                  </p>
                ) : appointments.length ? (
                  <div className="flex flex-col gap-3">
                    {appointments.map((appointment) => {
                      const staffName = appointment.staffName;

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
                {history?.id === selected && history.nextCursor && (
                  <Button
                    variant="outline"
                    disabled={loadingHistory}
                    onClick={() => void loadMoreHistory()}
                  >
                    {loadingHistory && (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    )}
                    {loadingHistory
                      ? "Loading appointments…"
                      : "Load more appointments"}
                  </Button>
                )}
              </section>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}
