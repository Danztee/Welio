"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type ReceptionistSettings } from "@/lib/domain/receptionist/settings";
import {
  dashboardPanelBodyClassName,
  dashboardPanelHeaderClassName,
} from "@/components/platform/panel-styles";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent } from "react";

type EditableSettings = Omit<ReceptionistSettings, "faqs"> & {
  faqs: (ReceptionistSettings["faqs"][number] & { id: string })[];
};

export function ReceptionistConfiguration({
  settings,
  update,
  save,
  saving,
  testing,
  dirty,
}: {
  settings: EditableSettings;
  update: <K extends keyof EditableSettings>(
    key: K,
    value: EditableSettings[K],
  ) => void;
  save: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  saving: boolean;
  testing: boolean;
  dirty: boolean;
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader
        className={`${dashboardPanelHeaderClassName} flex flex-wrap items-center justify-between gap-3 border-b`}
      >
        <CardTitle>
          <h2>Customer experience</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className={dashboardPanelBodyClassName}>
        <form onSubmit={save} className="min-w-0">
          <FieldGroup>
            <section className="flex flex-col gap-4 border-b pb-6">
              <Field orientation="horizontal">
                <Checkbox
                  className="mt-0.5"
                  id="receptionist-enabled"
                  checked={settings.enabled}
                  onCheckedChange={(checked) => update("enabled", checked)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="receptionist-enabled">
                    Enable customer chat
                  </FieldLabel>
                  <FieldDescription>
                    The booking form remains available when chat is paused.
                  </FieldDescription>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="receptionist-greeting">
                  Greeting
                </FieldLabel>
                <Textarea
                  id="receptionist-greeting"
                  placeholder="Welcome! How can we help you today?"
                  required
                  maxLength={240}
                  rows={2}
                  value={settings.greeting}
                  onChange={(event) => update("greeting", event.target.value)}
                />
                <FieldDescription>
                  The first message customers see when they open a conversation.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="receptionist-instructions">
                  Business instructions
                </FieldLabel>
                <Textarea
                  id="receptionist-instructions"
                  placeholder="Describe your services, preferred tone, and useful guidance for customers."
                  maxLength={2400}
                  rows={4}
                  value={settings.instructions}
                  onChange={(event) =>
                    update("instructions", event.target.value)
                  }
                />
                <FieldDescription>
                  Add tone and service guidance. Prices and availability come
                  from your saved business data.
                </FieldDescription>
              </Field>
            </section>
            <section className="flex flex-col gap-4 border-b pb-6">
              <h2 className="text-base font-medium">Allowed actions</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                The receptionist can answer service and FAQ questions. It cannot
                take payments, cancel bookings, or access customer records.
              </p>
              <Field orientation="horizontal">
                <Checkbox
                  id="receptionist-availability"
                  checked={settings.allowAvailability}
                  onCheckedChange={(checked) => {
                    update("allowAvailability", checked);
                    update("allowBooking", checked && settings.allowBooking);
                  }}
                />
                <FieldLabel htmlFor="receptionist-availability">
                  Check available appointment times
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="receptionist-booking"
                  checked={settings.allowBooking}
                  disabled={!settings.allowAvailability}
                  onCheckedChange={(checked) => update("allowBooking", checked)}
                />
                <FieldLabel htmlFor="receptionist-booking">
                  Prepare booking requests for customer confirmation
                </FieldLabel>
              </Field>
            </section>
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-medium">
                  Frequently asked questions
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={settings.faqs.length >= 12}
                  onClick={() =>
                    update("faqs", [
                      ...settings.faqs,
                      { id: crypto.randomUUID(), question: "", answer: "" },
                    ])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  Add FAQ
                </Button>
              </div>
              {!settings.faqs.length && (
                <p className="text-sm text-muted-foreground">
                  Add answers about service areas, preparation, or business
                  policies.
                </p>
              )}
              {settings.faqs.map((faq, index) => (
                <FieldSet
                  key={faq.id}
                  className="flex min-w-0 flex-col gap-4 rounded-lg border p-4"
                >
                  <FieldLegend variant="label">FAQ {index + 1}</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor={`faq-question-${index}`}>
                      Question
                    </FieldLabel>
                    <Input
                      id={`faq-question-${index}`}
                      placeholder="e.g. What areas do you serve?"
                      required
                      maxLength={200}
                      value={faq.question}
                      onChange={(event) =>
                        update(
                          "faqs",
                          settings.faqs.map((entry, i) =>
                            i === index
                              ? { ...entry, question: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`faq-answer-${index}`}>
                      Answer
                    </FieldLabel>
                    <Textarea
                      id={`faq-answer-${index}`}
                      placeholder="Add a clear answer for customers."
                      required
                      rows={2}
                      maxLength={1000}
                      value={faq.answer}
                      onChange={(event) =>
                        update(
                          "faqs",
                          settings.faqs.map((entry, i) =>
                            i === index
                              ? { ...entry, answer: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-end"
                    onClick={() =>
                      update(
                        "faqs",
                        settings.faqs.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2Icon data-icon="inline-start" />
                    Remove FAQ
                  </Button>
                </FieldSet>
              ))}
            </section>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving || testing || !dirty}>
                {saving ? "Saving…" : "Save settings"}
              </Button>
              {dirty && (
                <span className="text-xs text-muted-foreground">
                  Unsaved changes
                </span>
              )}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
