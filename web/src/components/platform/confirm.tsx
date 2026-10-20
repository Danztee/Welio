"use client";

import { useState, ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function Confirm({
  title,
  children,
  onConfirm,
  onClose,
  label = "Confirm",
  variant = "default",
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  label?: string;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={busy} variant="secondary" onClick={onClose}>
            Go back
          </Button>
          <Button
            variant={variant}
            disabled={busy}
            onClick={async () => {
              if (busy) return;

              setBusy(true);
              try {
                await onConfirm();
                toast.success("Done.");
                onClose();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Please try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
