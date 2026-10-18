"use client";

import { Notice } from "@/components/platform/shared";
import { Bubble, BubbleContent } from "@welio/ui/components/bubble";
import { Button } from "@welio/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@welio/ui/components/card";
import { Message, MessageContent } from "@welio/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@welio/ui/components/message-scroller";
import { Spinner } from "@welio/ui/components/spinner";
import type {
  Proposal,
  ReceptionistActivity,
} from "@welio/domain/receptionist/contract";
import { type ReceptionistSettings } from "@welio/domain/receptionist/settings";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { dashboardPanelHeaderClassName } from "@/components/platform/panel-styles";
import { RotateCcwIcon } from "lucide-react";
import { BookingProposalDetails } from "./booking-proposal-details";
import { ChatComposer } from "./chat-composer";
import { ReceptionistConversationHeader } from "./receptionist-conversation-header";
import { ReceptionistMessage } from "./receptionist-message";
import { ReceptionistQuickActions } from "./receptionist-quick-actions";

type Data = WorkspaceDashboardData;
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
  activeMessage,
  streamingReply,
  activity,
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
  activeMessage: string | null;
  streamingReply: string;
  activity: ReceptionistActivity | null;
  text: string;
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  setText: React.Dispatch<React.SetStateAction<string>>;
  test: (message: string) => Promise<void>;
}) {
  const w = workspace;

  return (
    <section className="min-w-0 [@media(min-width:80rem)_and_(min-height:700px)]:sticky [@media(min-width:80rem)_and_(min-height:700px)]:top-6">
      <Card className="flex min-w-0 flex-col gap-0 overflow-hidden py-0 [@media(min-width:80rem)_and_(min-height:700px)]:max-h-[calc(100svh-12rem)]">
        <CardHeader
          className={`${dashboardPanelHeaderClassName} flex shrink-0 flex-wrap items-center justify-between gap-3 border-b`}
        >
          <div className="min-w-0">
            <CardTitle>
              <h2>Test your receptionist</h2>
            </CardTitle>
            <CardDescription className="mt-1">
              Private preview. No appointments are created.
            </CardDescription>
          </div>
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
        <ReceptionistConversationHeader
          businessName={w.name}
          logo={w.logo}
          status="preview"
        />
        <MessageScrollerProvider autoScroll>
          <MessageScroller
            className="h-[min(360px,40svh)] min-h-56 bg-card [@media(min-width:80rem)_and_(min-height:700px)]:min-h-0"
            role="log"
            aria-label="Preview conversation"
            aria-live="polite"
          >
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-4 p-4 sm:p-5">
                <MessageScrollerItem messageId="welcome">
                  <div className="flex flex-col gap-3">
                    <ReceptionistMessage>{saved.greeting}</ReceptionistMessage>
                    {turns.length === 0 && !testing && (
                      <ReceptionistQuickActions
                        disabled={dirty || !aiConfigured}
                        onSelect={(message) => void test(message)}
                      />
                    )}
                  </div>
                </MessageScrollerItem>
                {turns.map((turn, index) => (
                  <MessageScrollerItem
                    key={index}
                    messageId={`preview-${index}`}
                    scrollAnchor
                  >
                    <div className="flex flex-col gap-3">
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
                {activeMessage && (
                  <MessageScrollerItem messageId="pending" scrollAnchor>
                    <div className="flex flex-col gap-3">
                      <Message align="end">
                        <MessageContent className="max-w-[88%]">
                          <Bubble align="end" className="max-w-full">
                            <BubbleContent className="whitespace-pre-wrap">
                              {activeMessage}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                      <ReceptionistMessage activity={activity}>
                        {streamingReply}
                      </ReceptionistMessage>
                    </div>
                  </MessageScrollerItem>
                )}
                {testing && !activeMessage && (
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
