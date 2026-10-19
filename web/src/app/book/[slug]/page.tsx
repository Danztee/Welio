import { notFound } from "next/navigation";
import { BookingShell } from "@/components/workspace/booking-ui";
import { PublicBooking } from "@/components/workspace/public-booking";
import type { Catalog } from "@/lib/domain/bookings/contract";
import { BookingLocation } from "@/lib/domain/workspaces/enums";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { backendRequest, BackendError } from "@/lib/backend/server-api";

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
  let settings: { enabled: boolean; greeting: string };
  try {
    const encodedSlug = encodeURIComponent(slug);
    [catalog, settings] = await Promise.all([
      backendRequest<Catalog>(`/v1/book/${encodedSlug}`),
      backendRequest<{ enabled: boolean; greeting: string }>(
        `/v1/book/${encodedSlug}/receptionist`,
      ),
    ]);
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) notFound();

    throw e;
  }

  const serviceAreaSummary = catalog.serviceArea
    ?.split(/\r?\n/)
    .map((area) => area.trim())
    .filter(Boolean)
    .join(", ");

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
            {catalog.bookingLocation === BookingLocation.Both
              ? `Choose your address or visit ${catalog.businessAddress}${serviceAreaSummary ? ` · At-home service in ${serviceAreaSummary}` : ""}`
              : catalog.bookingLocation === BookingLocation.BusinessAddress
                ? `Appointments at ${catalog.businessAddress}`
                : `Serving ${serviceAreaSummary}`}{" "}
            · Times shown in {catalog.timeZone}
          </p>
        </div>
      </div>
      <PublicBooking
        catalog={catalog}
        configured={settings.enabled}
        greeting={settings.greeting}
        chat={(await searchParams).mode === "chat"}
      />
    </BookingShell>
  );
}
