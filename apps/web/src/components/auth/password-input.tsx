"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@welio/ui/components/input-group";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";

export function PasswordInput(
  props: Omit<ComponentProps<typeof InputGroupInput>, "type">,
) {
  const [visible, setVisible] = useState(false);

  return (
    <InputGroup className="h-9">
      <InputGroupInput
        {...props}
        type={visible ? "text" : "password"}
        maxLength={128}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-sm"
          className="size-8"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={props.id}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? (
            <EyeOffIcon aria-hidden="true" />
          ) : (
            <EyeIcon aria-hidden="true" />
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
