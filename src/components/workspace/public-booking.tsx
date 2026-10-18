"use client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { floatingSheetClassName } from "@/components/ui/sheet-styles";
import type { Catalog } from "@/lib/bookings/contract";
import { MessageCircleIcon, SparklesIcon } from "lucide-react";
import { RealBookingForm } from "./booking-ui";
import { ReceptionistChat } from "./receptionist-chat";
export function PublicBooking({
  catalog,
  configured,
  chat = false,
  greeting,
}: {
  catalog: Catalog;
  configured: boolean;
  chat?: boolean;
  greeting: string;
}) {
  return (
    <>
      <RealBookingForm catalog={catalog} />
      <Sheet defaultOpen={chat}>
        <SheetTrigger
          render={
            <Button
              className="fixed right-5 bottom-5 rounded-full shadow-lg sm:right-6 sm:bottom-6"
              aria-label="Talk to us"
            />
          }
        >
          <MessageCircleIcon data-icon="inline-start" />
          Talk to us
        </SheetTrigger>
        <SheetContent side="right" className={floatingSheetClassName}>
          <SheetHeader className="flex-row items-center gap-3 border-b px-4 py-3 pr-12">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <SparklesIcon aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <SheetTitle className="truncate">{catalog.name}</SheetTitle>
              <SheetDescription className="sr-only">
                Ask about services, availability, and appointments.
              </SheetDescription>
            </span>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <ReceptionistChat
              slug={catalog.slug}
              configured={configured}
              greeting={greeting}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
