"use client";
import { Grid, Status } from "@/components/platform/shared";
import { SearchField } from "@/components/platform/search-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { workspaceDetail } from "@/lib/workspaces/repository";
import { useState } from "react";
import { formatWhen } from "./booking-format";
type Data = Awaited<ReturnType<typeof workspaceDetail>>;
export function RealCustomers({ data }: { data: Data }) {
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const customer = data.customers.find((c) => c.id === selected);
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
            cell: (c) => (
              <Button
                variant="link"
                className="h-auto justify-start p-0"
                onClick={() => setSelected(c.id)}
              >
                {c.name}
              </Button>
            ),
          },
          { label: "Email", cell: (c) => c.email ?? "—" },
          { label: "Phone", cell: (c) => c.phone ?? "—" },
          {
            label: "Appointments",
            cell: (c) =>
              data.bookings.filter((a) => a.customerId === c.id).length,
          },
        ]}
      />
      {customer && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setSelected("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{customer.name}</DialogTitle>
              <DialogDescription>
                {customer.email} · {customer.phone || "No phone added"}
              </DialogDescription>
            </DialogHeader>
            <Grid
              empty="No appointments yet"
              emptyDescription="This customer hasn’t booked an appointment yet."
              rows={data.bookings.filter((a) => a.customerId === customer.id)}
              columns={[
                { label: "Service", cell: (a) => a.serviceName },
                {
                  label: "When",
                  cell: (a) => formatWhen(a.startsAt, a.timeZone),
                },
                { label: "Status", cell: (a) => <Status value={a.status} /> },
                { label: "Booked contact", cell: (a) => a.customerName },
              ]}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
