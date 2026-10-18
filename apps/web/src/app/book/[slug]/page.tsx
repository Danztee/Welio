import { loadReceptionistConfiguration } from "@welio/db/receptionist/configuration";
import { notFound } from "next/navigation";
import { getDatabase } from "@welio/db";
import { getCatalog } from "@welio/db/bookings";
import { BookingError } from "@welio/domain/bookings/errors";
import { BookingShell } from "@/components/workspace/booking-ui";
import { PublicBooking } from "@/components/workspace/public-booking";
import { aiConfigured } from "@/lib/receptionist/provider";
import type { Catalog } from "@welio/domain/bookings/contract";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@welio/ui/components/avatar";

export const metadata = {
  title: "Book an appointment",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
  searchParams,
}: PageProps<"/book/[slug]">) {
  const { slug } = await params;
  let catalog: Catalog;
  try {
    catalog = await getCatalog(getDatabase(), { slug });
  } catch (e) {
    if (e instanceof BookingError) notFound();

    throw e;
  }

  const settings = await loadReceptionistConfiguration(getDatabase(), slug);

  return (
    <BookingShell>
      <div className="flex items-center gap-3">
        {catalog.logo && (
          <Avatar className="size-12 rounded-xl after:rounded-xl">
            <AvatarImage
              src={catalog.logo}
              alt=""
              className="rounded-xl object-contain"
            />
            <AvatarFallback className="rounded-xl">
              {catalog.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div>
          <h1 className="text-2xl font-medium">{catalog.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {catalog.bookingLocation === "business_address"
              ? `Appointments at ${catalog.serviceArea}`
              : `Serving ${catalog.serviceArea}`}{" "}
            · Times shown in {catalog.timeZone}
          </p>
        </div>
      </div>
      <PublicBooking
        catalog={catalog}
        configured={aiConfigured() && settings.enabled}
        greeting={settings.greeting}
        chat={(await searchParams).mode === "chat"}
      />
    </BookingShell>
  );
}
