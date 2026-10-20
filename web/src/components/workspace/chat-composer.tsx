"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { ArrowUpIcon } from "lucide-react";

export function ChatComposer({
  text,
  setText,
  busy,
  disabled,
  sendMessage,
  id = "receptionist-message",
  label = "Message",
  hideLabel = false,
  sendLabel = "Send message",
}: {
  text: string;
  setText: (value: string) => void;
  busy: boolean;
  disabled: boolean;
  sendMessage: (value: string) => Promise<void>;
  id?: string;
  label?: string;
  hideLabel?: boolean;
  sendLabel?: string;
}) {
  return (
    <form
      className="shrink-0 bg-card px-3 pb-3 pt-2 sm:px-4 sm:pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        void sendMessage(text);
      }}
    >
      <Field className="gap-1.5">
        <FieldLabel
          htmlFor={id}
          className={
            hideLabel ? "sr-only" : "text-xs font-normal text-muted-foreground"
          }
        >
          {label}
        </FieldLabel>
        <InputGroup className="h-auto min-h-24 flex-col items-stretch justify-between rounded-2xl border-border/80 bg-background px-0 shadow-sm transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 has-disabled:bg-background has-disabled:opacity-100">
          <InputGroupTextarea
            id={id}
            name="message"
            placeholder="Type a message…"
            rows={1}
            maxLength={1600}
            value={text}
            disabled={busy || disabled}
            onChange={(event) => setText(event.target.value)}
            className="min-h-14 max-h-28 w-full px-3 py-2.5 text-sm leading-5"
          />
          <InputGroupAddon
            align="block-end"
            className="w-full justify-end px-2 pb-2 pt-1 has-[>button]:mr-0"
          >
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="size-9 shrink-0 rounded-full"
              aria-label={sendLabel}
              disabled={busy || disabled || !text.trim()}
            >
              {busy ? <Spinner /> : <ArrowUpIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  );
}
