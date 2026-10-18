"use client";

import { Notice } from "@/components/platform/shared";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import type { Proposal } from "@/lib/receptionist/contract";
import { type ReceptionistSettings } from "@/lib/receptionist/settings";
import type { workspaceDetail } from "@/lib/workspaces/repository";
import { dashboardPanelHeaderClassName } from "@/components/platform/panel-styles";
import { RotateCcwIcon, SparklesIcon } from "lucide-react";
import { BookingProposalDetails } from "./booking-proposal-details";
import { ChatComposer } from "./chat-composer";
import { ReceptionistMessage } from "./receptionist-message";

type Data = Awaited<ReturnType<typeof workspaceDetail>>;
type Turn = { text: string; reply: string; proposal: Proposal | null };
type EditableSettings = Omit<ReceptionistSettings, "faqs"> & {
  faqs: (ReceptionistSettings["faqs"][number] & { id: string })[];
};

export function ReceptionistPreview({
  workspace,
  dirty,
  aiConfigured,
  turns,
  saved,
  testing,
  text,
  setTurns,
  setText,
  test,
}: {
  workspace: Data["workspace"];
  dirty: boolean;
  aiConfigured: boolean;
  turns: Turn[];
  saved: EditableSettings;
  testing: boolean;
  text: string;
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  setText: React.Dispatch<React.SetStateAction<string>>;
  test: () => Promise<void>;
}) {
  const w = workspace;
  return (
    <section className="min-w-0 [@media(min-width:80rem)_and_(min-height:700px)]:sticky [@media(min-width:80rem)_and_(min-height:700px)]:top-6">
      <Card className="min-w-0 gap-0 py-0 [@media(min-width:80rem)_and_(min-height:700px)]:max-h-[calc(100svh-12rem)]">
        <CardHeader
          className={`${dashboardPanelHeaderClassName} flex shrink-0 flex-wrap items-center justify-between gap-3 border-b`}
        >
          <CardTitle>
            <h2>Test your receptionist</h2>
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={testing || (!turns.length && !text)}
            onClick={() => {
              setTurns([]);
              setText("");
            }}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reset
          </Button>
        </CardHeader>
        <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 sm:px-6">
          <p className="text-sm text-muted-foreground">
            Private preview. No bookings are made or emails sent.
          </p>
        </div>
        {(dirty || !aiConfigured) && (
          <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 sm:px-6">
            {dirty && (
              <Notice tone="warning">
                Save your configuration changes before testing.
              </Notice>
            )}
            {!aiConfigured && (
              <Notice tone="warning">
                The receptionist is temporarily unavailable. Please try again
                later.
              </Notice>
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-3 bg-muted/30 px-4 pt-4 sm:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <SparklesIcon aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{w.name}</p>
          </div>
        </div>
        <MessageScrollerProvider autoScroll>
          <MessageScroller
            className="h-[min(360px,40svh)] min-h-56 bg-muted/30 [@media(min-width:80rem)_and_(min-height:700px)]:min-h-0"
            role="log"
            aria-label="Preview conversation"
            aria-live="polite"
          >
            <MessageScrollerViewport>
              <MessageScrollerContent className="p-4 sm:p-5">
                <MessageScrollerItem messageId="welcome">
                  <ReceptionistMessage>{saved.greeting}</ReceptionistMessage>
                </MessageScrollerItem>
                {turns.map((turn, index) => (
                  <MessageScrollerItem
                    key={index}
                    messageId={`preview-${index}`}
                    scrollAnchor
                  >
                    <div className="flex flex-col gap-4">
                      <Message align="end">
                        <MessageContent className="max-w-[88%]">
                          <Bubble align="end" className="max-w-full">
                            <BubbleContent className="whitespace-pre-wrap">
                              {turn.text}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                      <ReceptionistMessage>{turn.reply}</ReceptionistMessage>
                      {turn.proposal && (
                        <Card size="sm">
                          <CardHeader>
                            <CardTitle>Booking preview</CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-3">
                            <BookingProposalDetails proposal={turn.proposal} />
                            <p className="text-xs text-muted-foreground">
                              This is a preview. No appointment has been
                              created.
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </MessageScrollerItem>
                ))}
                {testing && (
                  <MessageScrollerItem messageId="pending">
                    <ReceptionistMessage>
                      <span
                        role="status"
                        className="flex items-center gap-2 text-muted-foreground"
                      >
                        <Spinner aria-hidden="true" />
                        Thinking…
                      </span>
                    </ReceptionistMessage>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
        <ChatComposer
          id="receptionist-preview-message"
          label="Test message"
          sendLabel="Send test message"
          text={text}
          setText={setText}
          busy={testing}
          disabled={dirty || !aiConfigured}
          sendMessage={test}
        />
      </Card>
    </section>
  );
}
