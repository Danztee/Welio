"use client";
import { setBookingPublishedAction } from "@/app/dashboard/booking-actions";
import { Confirm } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { TextLink } from "@/components/ui/text-link";
import { toast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { CopyIcon } from "lucide-react";
import { useState } from "react";

type Data = WorkspaceDashboardData;
async function save(workspaceId: string, input: unknown) {
  const result = await runServerAction(() =>
    setBookingPublishedAction(workspaceId, input),
  );
  if (!result.ok) throw Error(result.error);

  return result;
}

export function PublicBookingSettings({
  data,
  publicAppOrigin,
}: {
  data: Data;
  publicAppOrigin: string;
}) {
  const router = useRouter();
  const w = data.workspace;
  const bookingUrl = new URL(`/book/${w.slug}`, publicAppOrigin).toString();
  const [publishing, setPublishing] = useState(false);

  async function copyBookingUrl() {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      toast.add({ title: "Booking page link copied.", type: "success" });
    } catch {
      toast.add({
        title: "Could not copy the booking page link.",
        type: "error",
      });
    }
  }

  return (
    <>
      <section aria-labelledby="public-access-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 id="public-access-heading" className="text-sm font-semibold">
              Public access
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {w.isPublished
                ? "Customers can use your booking page."
                : "Publish when your services and team are ready."}
            </p>
          </div>
        </div>
        {w.isPublished && (
          <div className="mt-5 flex max-w-full flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Booking page link
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <TextLink
                className="min-w-0 flex-1 text-sm break-all"
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {bookingUrl}
              </TextLink>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy booking page link"
                title="Copy booking page link"
                onClick={() => void copyBookingUrl()}
              >
                <CopyIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
        <Button
          className="mt-6"
          variant={w.isPublished ? "destructive" : "success"}
          onClick={() => setPublishing(true)}
        >
          {w.isPublished ? "Unpublish page" : "Publish booking page"}
        </Button>
      </section>
      {publishing && (
        <Confirm
          title={
            w.isPublished ? "Unpublish booking page?" : "Publish booking page?"
          }
          label={w.isPublished ? "Unpublish" : "Publish"}
          variant={w.isPublished ? "destructive" : "success"}
          onClose={() => setPublishing(false)}
          onConfirm={async () => {
            await save(w.id, !w.isPublished);
            router.refresh();
          }}
        >
          {w.isPublished
            ? "New public bookings will stop. Existing customers can still manage their appointments using their private links."
            : "Your business, services, prices, and staff names will become public on the booking page. Complete setup and assign staff before publishing."}
        </Confirm>
      )}
    </>
  );
}
