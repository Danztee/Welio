"use client";

import { saveReceptionistAction } from "@/app/dashboard/receptionist-actions";
import {
  proposalSchema,
  type Proposal,
  type ReceptionistActivity,
} from "@/lib/domain/receptionist/contract";
import {
  receptionistSettingsSchema,
  type ReceptionistSettings,
} from "@/lib/domain/receptionist/settings";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { apiUrl } from "@/lib/api-url";
import { readReceptionistStream } from "@/lib/receptionist/stream-client";
import { ReceptionistConfiguration } from "./receptionist-configuration";
import { ReceptionistPreview } from "./receptionist-preview";

type Data = WorkspaceDashboardData;
type Turn = {
  id: string;
  text: string;
  reply: string;
  proposal: Proposal | null;
};
const previewResultSchema = z.object({
  reply: z.string(),
  proposal: proposalSchema.nullable(),
});
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
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [activity, setActivity] = useState<ReceptionistActivity | null>(null);
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
      toast.error(parsed.error.issues[0].message);

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

  async function test(messageOverride = text) {
    const message = messageOverride.trim();
    if (!message || pending.current || dirty || !aiConfigured) return;

    pending.current = true;
    setTesting(true);
    setActiveMessage(message);
    setStreamingReply("");
    setActivity("thinking");
    setText("");
    try {
      const response = await fetch(
        apiUrl(
          `/v1/workspaces/${encodeURIComponent(w.id)}/receptionist/preview`,
        ),
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Welio-Workspace": w.id,
          },
          body: JSON.stringify({
            text: message,
            turns: turns.slice(-5).map(({ text, reply }) => ({ text, reply })),
          }),
        },
      );
      const result = await readReceptionistStream(
        response,
        (delta) => setStreamingReply((previous) => previous + delta),
        previewResultSchema,
        setActivity,
      );
      setTurns((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: message,
          reply: result.reply,
          proposal: result.proposal,
        },
      ]);
      setText("");
    } catch (error) {
      setText(message);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not test the receptionist.",
      );
    } finally {
      pending.current = false;
      setActiveMessage(null);
      setStreamingReply("");
      setActivity(null);
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
        activeMessage={activeMessage}
        streamingReply={streamingReply}
        activity={activity}
        text={text}
        setTurns={setTurns}
        setText={setText}
        test={test}
      />
    </div>
  );
}
