"use client";
import { acceptInviteAction } from "@/app/dashboard/workspace-actions";
import { Button } from "@welio/ui/components/button";
import { runServerAction } from "@/lib/run-server-action";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await runServerAction(() =>
              acceptInviteAction(token),
            );
            if (result.ok) {
              toast.success("Invitation accepted.");
              router.push(`/dashboard?workspace=${result.id}`);
              router.refresh();
            } else toast.error(result.error);
          } catch {
            toast.error("Could not accept this invitation. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : "Accept invitation"}
      </Button>
    </>
  );
}
