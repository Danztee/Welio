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
  sendLabel = "Send message",
}: {
  text: string;
  setText: (value: string) => void;
  busy: boolean;
  disabled: boolean;
  sendMessage: (value: string) => Promise<void>;
  id?: string;
  label?: string;
  sendLabel?: string;
}) {
  return (
    <form
      className="shrink-0 bg-card p-3 pt-2"
      action={() => sendMessage(text)}
    >
      <Field className="gap-1.5">
        <FieldLabel
          htmlFor={id}
          className="text-xs font-normal text-muted-foreground"
        >
          {label}
        </FieldLabel>
        <InputGroup className="items-end rounded-2xl bg-background shadow-xs has-disabled:bg-background has-disabled:opacity-100">
          <InputGroupTextarea
            id={id}
            name="message"
            rows={1}
            maxLength={1600}
            placeholder="Ask about services or available times"
            value={text}
            disabled={busy || disabled}
            onChange={(event) => setText(event.target.value)}
            className="max-h-28 min-h-12 px-3 py-2"
          />
          <InputGroupAddon align="inline-end" className="pb-1.5">
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="shrink-0 rounded-full"
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
