"use client";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { type ReactNode } from "react";

export function ReceptionistMessage({ children }: { children: ReactNode }) {
  return (
    <Message>
      <MessageContent className="max-w-[88%]">
        <Bubble variant="muted" className="max-w-full">
          <BubbleContent className="whitespace-pre-wrap">
            {children}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
