"use client";
import { bookingAction } from "@/app/dashboard/booking-actions";
import { Confirm, Status } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { runServerAction } from "@/lib/run-server-action";
import type { workspaceDetail } from "@/lib/workspaces/repository";
import { TextLink } from "@/components/ui/text-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
type Data = Awaited<ReturnType<typeof workspaceDetail>>;
async function save(workspaceId: string, action: string, input: unknown) {
  const result = await runServerAction(() =>
    bookingAction(action, workspaceId, input),
  );
  if (!result.ok) throw Error(result.error);
  return result;
}
export function PublicBookingSettings({ data }: { data: Data }) {
  const router = useRouter();
  const w = data.workspace;
  const [publishing, setPublishing] = useState(false);

  return (
    <>
      <section aria-labelledby="public-access-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 id="public-access-heading" className="font-medium">
              Public access
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {w.isPublished
                ? "Customers can use your booking page."
                : "Publish when your services and team are ready."}
            </p>
          </div>
          <Status value={w.isPublished ? "Published" : "Unpublished"} />
        </div>
        {w.isPublished && (
          <Card size="sm" className="mt-6 w-fit max-w-full gap-2 p-3">
            <CardHeader className="px-0 pt-0">
              <CardDescription className="text-xs font-medium">
                Booking page link
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <TextLink
                className="inline-block text-sm"
                href={`/book/${w.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                /book/{w.slug}
              </TextLink>
            </CardContent>
          </Card>
        )}
        <Button
          className="mt-6"
          variant={w.isPublished ? "destructive" : "default"}
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
          variant={w.isPublished ? "destructive" : "default"}
          onClose={() => setPublishing(false)}
          onConfirm={async () => {
            await save(w.id, "publish", !w.isPublished);
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
