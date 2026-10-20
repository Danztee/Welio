"use client";
import { Spinner } from "@/components/ui/spinner";
import { acceptInviteAction } from "@/app/dashboard/workspace-actions";
import { Button } from "@/components/ui/button";
import { runServerAction } from "@/lib/run-server-action";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/ui/toast";

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
              toast.add({ title: "Invitation accepted.", type: "success" });
              router.push(`/dashboard?workspace=${result.id}`);
              router.refresh();
            } else toast.add({ title: result.error, type: "error" });
          } catch {
            toast.add({
              title: "Could not accept this invitation. Try again.",
              type: "error",
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
        {busy ? "Joining…" : "Accept invitation"}
      </Button>
    </>
  );
}
