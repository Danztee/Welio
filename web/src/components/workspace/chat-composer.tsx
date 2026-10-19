"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { SendIcon } from "lucide-react";

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
      className="shrink-0 border-t bg-card p-3 sm:px-4 sm:py-3"
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
        <InputGroup className="h-auto min-h-12 items-end rounded-xl bg-card shadow-none has-disabled:bg-card has-disabled:opacity-100">
          <InputGroupTextarea
            id={id}
            name="message"
            placeholder="Ask about services or availability…"
            rows={1}
            maxLength={1600}
            value={text}
            disabled={busy || disabled}
            onChange={(event) => setText(event.target.value)}
            className="max-h-28 min-h-12 px-3 py-2.5 text-sm leading-5"
          />
          <InputGroupAddon
            align="inline-end"
            className="pr-2.5 pb-1.5 has-[>button]:mr-0"
          >
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="shrink-0 rounded-lg"
              aria-label={sendLabel}
              disabled={busy || disabled || !text.trim()}
            >
              {busy ? <Spinner /> : <SendIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  );
}
