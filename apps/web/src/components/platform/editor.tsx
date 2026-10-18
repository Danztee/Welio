"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Checkbox } from "@welio/ui/components/checkbox";
import { Button } from "@welio/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@welio/ui/components/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSet,
  FieldLegend,
} from "@welio/ui/components/field";
import { Input } from "@welio/ui/components/input";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@welio/ui/components/combobox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@welio/ui/components/native-select";
import { Textarea } from "@welio/ui/components/textarea";
import type { EditorField } from "./editor-types";

export function Editor({
  title,
  description,
  fields,
  onSave,
  onClose,
  submitLabel = "Save changes",
  successMessage = "Changes saved.",
}: {
  title: string;
  description?: string;
  fields: EditorField[];
  onSave: (data: FormData) => void | Promise<void>;
  onClose: () => void;
  submitLabel?: string;
  successMessage?: string | false;
}) {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [multiSelectValues, setMultiSelectValues] = useState<
    Record<string, string[]>
  >(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.type === "multi-select")
        .map((field) => [
          field.name,
          Array.isArray(field.value) ? field.value : [],
        ]),
    ),
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    const form = e.currentTarget;
    const invalid = Array.from(form.elements).filter(
      (
        control,
      ): control is
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
        (control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement) &&
        !control.validity.valid,
    );
    if (invalid.length) {
      setFieldErrors(
        Object.fromEntries(
          invalid.map((control) => [control.name, control.validationMessage]),
        ),
      );
      invalid[0].focus();

      return;
    }

    setFieldErrors({});
    setBusy(true);
    try {
      await onSave(new FormData(e.currentTarget));
      if (successMessage) toast.success(successMessage);

      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={!busy} layout="form">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          noValidate
          method="post"
          onSubmit={submit}
          onChange={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLInputElement ||
              target instanceof HTMLSelectElement ||
              target instanceof HTMLTextAreaElement
            )
              setFieldErrors((current) => ({ ...current, [target.name]: "" }));
          }}
          className="flex min-h-0 flex-1 flex-col gap-6"
        >
          <div className="-m-1 min-h-0 overflow-y-auto overscroll-contain p-1">
            <FieldGroup>
              {fields.map((f) =>
                f.type === "multi-select" ? (
                  <FieldSet key={f.name}>
                    <FieldLegend variant="label">{f.label}</FieldLegend>
                    {f.options?.length ? (
                      <Combobox
                        items={f.options.map((option) => option.value)}
                        multiple
                        name={f.name}
                        value={multiSelectValues[f.name] ?? []}
                        onValueChange={(value) =>
                          setMultiSelectValues((current) => ({
                            ...current,
                            [f.name]: value,
                          }))
                        }
                        itemToStringLabel={(value) =>
                          f.options?.find((option) => option.value === value)
                            ?.label ?? value
                        }
                      >
                        <ComboboxChips>
                          <ComboboxValue>
                            {(multiSelectValues[f.name] ?? []).map((value) => (
                              <ComboboxChip key={value}>
                                {f.options?.find(
                                  (option) => option.value === value,
                                )?.label ?? value}
                              </ComboboxChip>
                            ))}
                          </ComboboxValue>
                          <ComboboxChipsInput
                            aria-label={f.label}
                            aria-invalid={Boolean(fieldErrors[f.name])}
                            placeholder="Search team members"
                          />
                        </ComboboxChips>
                        <ComboboxContent>
                          <ComboboxEmpty>
                            No matching team members.
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(value: string) => (
                              <ComboboxItem key={value} value={value}>
                                {f.options?.find(
                                  (option) => option.value === value,
                                )?.label ?? value}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {f.emptyMessage ?? "No options available."}
                      </p>
                    )}
                    {fieldErrors[f.name] && (
                      <FieldError id={`edit-${f.name}-error`}>
                        {fieldErrors[f.name]}
                      </FieldError>
                    )}
                  </FieldSet>
                ) : f.type === "multi" ? (
                  <FieldSet key={f.name}>
                    <FieldLegend variant="label">{f.label}</FieldLegend>
                    {f.description && (
                      <p className="-mt-2 text-sm text-muted-foreground">
                        {f.description}
                      </p>
                    )}
                    <FieldGroup className="gap-2">
                      {f.options?.length ? (
                        f.options.map((o) => (
                          <Field key={o.value} orientation="horizontal">
                            <Checkbox
                              id={`${f.name}-${o.value}`}
                              name={f.name}
                              aria-invalid={Boolean(fieldErrors[f.name])}
                              aria-describedby={
                                fieldErrors[f.name]
                                  ? `edit-${f.name}-error`
                                  : undefined
                              }
                              value={o.value}
                              defaultChecked={
                                Array.isArray(f.value) &&
                                f.value.includes(o.value)
                              }
                            />
                            <FieldLabel htmlFor={`${f.name}-${o.value}`}>
                              {o.label}
                            </FieldLabel>
                          </Field>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {f.emptyMessage ?? "No options available."}
                        </p>
                      )}
                    </FieldGroup>
                  </FieldSet>
                ) : (
                  <Field
                    key={f.name}
                    data-invalid={Boolean(fieldErrors[f.name])}
                  >
                    <FieldLabel htmlFor={`edit-${f.name}`}>
                      {f.label}
                    </FieldLabel>
                    {f.type === "select" ? (
                      <NativeSelect
                        id={`edit-${f.name}`}
                        name={f.name}
                        aria-invalid={Boolean(fieldErrors[f.name])}
                        aria-describedby={
                          fieldErrors[f.name]
                            ? `edit-${f.name}-error`
                            : undefined
                        }
                        defaultValue={String(f.value ?? "")}
                        required={f.required}
                        className="w-full"
                      >
                        {f.options?.map((o) => (
                          <NativeSelectOption
                            key={o.value}
                            value={o.value}
                            disabled={o.value === ""}
                          >
                            {o.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : f.type === "textarea" ? (
                      <Textarea
                        id={`edit-${f.name}`}
                        name={f.name}
                        aria-invalid={Boolean(fieldErrors[f.name])}
                        aria-describedby={
                          fieldErrors[f.name]
                            ? `edit-${f.name}-error`
                            : undefined
                        }
                        defaultValue={String(f.value ?? "")}
                        required={f.required}
                        placeholder={f.placeholder}
                        maxLength={f.maxLength ?? 2000}
                      />
                    ) : (
                      <Input
                        id={`edit-${f.name}`}
                        name={f.name}
                        aria-invalid={Boolean(fieldErrors[f.name])}
                        aria-describedby={
                          fieldErrors[f.name]
                            ? `edit-${f.name}-error`
                            : undefined
                        }
                        type={f.type ?? "text"}
                        autoComplete={f.autoComplete}
                        placeholder={f.placeholder}
                        defaultValue={String(f.value ?? "")}
                        required={f.required}
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        maxLength={f.type === "email" ? 254 : 200}
                      />
                    )}
                    {fieldErrors[f.name] && (
                      <FieldError id={`edit-${f.name}-error`}>
                        {fieldErrors[f.name]}
                      </FieldError>
                    )}
                  </Field>
                ),
              )}
            </FieldGroup>
          </div>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              disabled={busy}
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
