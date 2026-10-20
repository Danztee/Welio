"use client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { floatingSheetClassName } from "@/components/ui/sheet-styles";
import type { Catalog } from "@/lib/domain/bookings/contract";
import { MessageCircleIcon } from "lucide-react";
import { RealBookingForm } from "./booking-ui";
import { ReceptionistChat } from "./receptionist-chat";

export function PublicBooking({
  catalog,
  configured,
  chat = false,
  greeting,
  initialSelection,
}: {
  catalog: Catalog;
  configured: boolean;
  chat?: boolean;
  greeting: string;
  initialSelection?: { serviceId: string; date: string; staffId: string };
}) {
  return (
    <>
      <RealBookingForm catalog={catalog} initialSelection={initialSelection} />
      <Sheet defaultOpen={chat}>
        <SheetTrigger
          render={
            <Button
              className="fixed right-4 bottom-4 size-11 rounded-full p-0 shadow-lg sm:right-6 sm:bottom-6 sm:h-9 sm:w-auto sm:px-3"
              aria-label="Talk to us"
            />
          }
        >
          <MessageCircleIcon />
          <span className="sr-only sm:not-sr-only">Talk to us</span>
        </SheetTrigger>
        <SheetContent
          side="right"
          showCloseButton={false}
          className={floatingSheetClassName}
        >
          <SheetTitle className="sr-only">Talk to {catalog.name}</SheetTitle>
          <SheetDescription className="sr-only">
            Ask about services, availability, and appointments.
          </SheetDescription>
          <ReceptionistChat
            slug={catalog.slug}
            businessName={catalog.name}
            logo={catalog.logo}
            configured={configured}
            greeting={greeting}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
