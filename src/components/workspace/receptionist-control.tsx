"use client";

import {
  previewReceptionistAction,
  saveReceptionistAction,
} from "@/app/dashboard/receptionist-actions";
import type { Proposal } from "@/lib/receptionist/contract";
import {
  receptionistSettingsSchema,
  type ReceptionistSettings,
} from "@/lib/receptionist/settings";
import { runServerAction } from "@/lib/run-server-action";
import type { workspaceDetail } from "@/lib/workspaces/repository";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ReceptionistConfiguration } from "./receptionist-configuration";
import { ReceptionistPreview } from "./receptionist-preview";

type Data = Awaited<ReturnType<typeof workspaceDetail>>;
type Turn = { text: string; reply: string; proposal: Proposal | null };
type EditableSettings = Omit<ReceptionistSettings, "faqs"> & {
  faqs: (ReceptionistSettings["faqs"][number] & { id: string })[];
};

export function ReceptionistControl({
  data,
  aiConfigured,
}: {
  data: Data;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const w = data.workspace;
  const [settings, setSettings] = useState<EditableSettings>(() => ({
    ...w.receptionistSettings,
    faqs: w.receptionistSettings.faqs.map((faq, index) => ({
      ...faq,
      id: `faq-${index}`,
    })),
  }));
  const [saved, setSaved] = useState(settings);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const [saving, setSaving] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [testing, setTesting] = useState(false);
  const pending = useRef(false);
  function update<K extends keyof EditableSettings>(
    key: K,
    value: EditableSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = receptionistSettingsSchema.safeParse({
      ...settings,
      faqs: settings.faqs.map(({ question, answer }) => ({ question, answer })),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your settings.");
      return;
    }
    setSaving(true);
    try {
      const result = await runServerAction(() =>
        saveReceptionistAction(w.id, parsed.data),
      );
      if (!result.ok) throw Error(result.error);
      setSaved(settings);
      setTurns([]);
      toast.success("Receptionist settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function test() {
    const message = text.trim();
    if (!message || pending.current || dirty || !aiConfigured) return;
    pending.current = true;
    setTesting(true);
    try {
      const result = await runServerAction(() =>
        previewReceptionistAction(w.id, {
          text: message,
          turns: turns.slice(-5).map(({ text, reply }) => ({ text, reply })),
        }),
      );
      if (!result.ok) throw Error(result.error);
      setTurns((current) => [
        ...current,
        { text: message, reply: result.reply, proposal: result.proposal },
      ]);
      setText("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not test the receptionist.",
      );
    } finally {
      pending.current = false;
      setTesting(false);
    }
  }
  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <ReceptionistConfiguration
        settings={settings}
        update={update}
        save={save}
        saving={saving}
        testing={testing}
        dirty={dirty}
      />
      <ReceptionistPreview
        workspace={w}
        dirty={dirty}
        aiConfigured={aiConfigured}
        turns={turns}
        saved={saved}
        testing={testing}
        text={text}
        setTurns={setTurns}
        setText={setText}
        test={test}
      />
    </div>
  );
}
