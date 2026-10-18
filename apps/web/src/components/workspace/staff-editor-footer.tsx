import { Button } from "@welio/ui/components/button";
import { DialogFooter } from "@welio/ui/components/dialog";

export function StaffEditorFooter({
  step,
  busy,
  hasWorker,
  onCancel,
  onBack,
}: {
  step: "profile" | "hours";
  busy: boolean;
  hasWorker: boolean;
  onCancel: () => void;
  onBack: () => void;
}) {
  if (step === "profile")
    return (
      <DialogFooter className="shrink-0">
        <Button
          type="button"
          disabled={busy}
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" form="staff-editor-form" disabled={busy}>
          Continue to booking hours
        </Button>
      </DialogFooter>
    );

  return (
    <DialogFooter className="shrink-0">
      <Button type="button" disabled={busy} variant="outline" onClick={onBack}>
        Back
      </Button>
      <Button type="submit" form="staff-editor-form" disabled={busy}>
        {busy ? "Saving…" : hasWorker ? "Save changes" : "Add team member"}
      </Button>
    </DialogFooter>
  );
}
