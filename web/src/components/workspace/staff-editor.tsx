"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { StaffAvailabilityFields } from "./staff-availability-fields";
import { StaffEditorFooter } from "./staff-editor-footer";
import { StaffFormFields } from "./staff-form-fields";

type Data = WorkspaceDashboardData;
export function StaffEditor({
  data,
  staffId,
  onClose,
  onSave,
}: {
  data: Data;
  staffId: string;
  onClose: () => void;
  onSave: (form: FormData) => Promise<void>;
}) {
  const worker = data.staff.find((s) => s.id === staffId);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"profile" | "hours">("profile");
  const [isActive, setIsActive] = useState(worker?.isActive ?? true);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);

  function continueToHours() {
    const name =
      formRef.current?.querySelector<HTMLInputElement>("#staff-name");
    const email =
      formRef.current?.querySelector<HTMLInputElement>("#staff-email");
    if (!name?.reportValidity() || !email?.reportValidity()) return;

    setStep("hours");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    if (step === "profile") {
      continueToHours();

      return;
    }

    const start =
      e.currentTarget.querySelector<HTMLInputElement>("#staff-start");
    const end = e.currentTarget.querySelector<HTMLInputElement>("#staff-end");
    if (!start?.reportValidity() || !end?.reportValidity()) return;

    setBusy(true);
    try {
      await onSave(new FormData(e.currentTarget));
      onClose();
    } catch (err) {
      toast.add({
        title:
          err instanceof Error
            ? err.message
            : "Could not save. Please try again.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (
            !open &&
            !busy &&
            (details.reason === "close-press" ||
              details.reason === "escape-key")
          ) {
            onClose();
          }
        }}
      >
        <DialogContent showCloseButton={!busy} layout="form">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editorTitle(step, Boolean(worker))}</DialogTitle>
            <DialogDescription>
              {step === "profile"
                ? "Add their profile first. You’ll set their weekly availability next."
                : "Choose when this person can take bookings each week."}
            </DialogDescription>
          </DialogHeader>
          <form
            ref={formRef}
            id="staff-editor-form"
            noValidate
            method="post"
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div
              ref={scrollRef}
              className="-m-1 min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            >
              <div className="flex flex-col gap-4 pb-1">
                <div hidden={step !== "profile"}>
                  <StaffFormFields
                    worker={worker}
                    isActive={isActive}
                    onActiveChange={setIsActive}
                  />
                </div>
                <div hidden={step !== "hours"} className="flex flex-col gap-4">
                  <StaffAvailabilityFields
                    worker={worker}
                    timeZone={data.workspace.timeZone}
                    isActive={isActive}
                  />
                </div>
              </div>
            </div>
          </form>
          <StaffEditorFooter
            step={step}
            busy={busy}
            hasWorker={Boolean(worker)}
            onCancel={onClose}
            onBack={() => setStep("profile")}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function editorTitle(step: "profile" | "hours", hasWorker: boolean) {
  if (step === "hours") return "Booking hours";

  return hasWorker ? "Edit team member" : "Add team member";
}
