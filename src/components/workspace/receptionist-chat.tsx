"use client";

import { z } from "zod";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import { chatStateSchema, type ChatState } from "@/lib/receptionist/contract";
import { Spinner } from "@/components/ui/spinner";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Message, MessageContent } from "@/components/ui/message";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Notice } from "@/components/platform/shared";
import { BookingResult } from "./booking-result";
import { ChatComposer } from "./chat-composer";
import { ReceptionistMessage } from "./receptionist-message";
import { empty } from "./receptionist-chat-shared";

export function ReceptionistChat({
  slug,
  configured,
  greeting = "Hello! How can I help you today?",
}: {
  slug: string;
  configured: boolean;
  greeting?: string;
}) {
  const [state, setState] = useState<ChatState>(empty);
  const [token, setToken] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [consent, setConsent] = useState(false);
  const started = useRef(false);
  const attempt = useRef<{ text: string; key: string } | null>(null);

  const startConversation = useCallback(async () => {
    setBusy(true);
    setConnectFailed(false);
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(data);
        throw new Error(
          message.success
            ? message.data.error
            : "Could not start the conversation. Please retry.",
        );
      }
      const next = chatStateSchema.parse(data);
      if (!next.token) throw new Error("Could not start the conversation.");
      setToken(next.token);
      setState(next);
    } catch (cause) {
      started.current = false;
      setConnectFailed(true);
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not start the conversation. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!configured || started.current) return;
    started.current = true;
    void startConversation();
  }, [configured, startConversation]);

  async function send(action: Record<string, unknown>) {
    setBusy(true);
    if (action.action === "message")
      setState((previous) => ({ ...previous, pending: null }));
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, token }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(data);
        throw new Error(
          message.success
            ? message.data.error
            : "Could not complete this request. Please retry.",
        );
      }
      setState(chatStateSchema.parse(data));
      setConsent(false);
      return true;
    } catch (cause) {
      toast.error(
        cause instanceof z.ZodError
          ? "Could not read the response. Please retry."
          : cause instanceof Error
            ? cause.message
            : "Connection failed. Please retry.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(message: string) {
    const value = message.trim();
    if (!value || busy || !token) return;
    if (attempt.current?.text !== value)
      attempt.current = { text: value, key: crypto.randomUUID() };
    if (
      await send({
        action: "message",
        text: attempt.current.text,
        key: attempt.current.key,
      })
    ) {
      setText("");
      attempt.current = null;
    }
  }

  return (
    <section
      aria-label="AI receptionist"
      className="flex h-full min-h-0 flex-col"
    >
      {!configured ? (
        <div className="p-4">
          <Notice tone="warning">
            The AI receptionist is not available yet. You can still book using
            the booking form.
          </Notice>
        </div>
      ) : (
        <>
          <MessageScrollerProvider autoScroll>
            <MessageScroller className="min-h-0 flex-1 bg-card">
              <MessageScrollerViewport>
                <MessageScrollerContent className="p-4 sm:p-5">
                  <MessageScrollerItem messageId="welcome">
                    <ReceptionistMessage>{greeting}</ReceptionistMessage>
                  </MessageScrollerItem>
                  {state.turns.map((turn) => (
                    <MessageScrollerItem
                      key={turn.key}
                      messageId={turn.key}
                      scrollAnchor
                    >
                      <div className="flex flex-col gap-5">
                        <Message align="end">
                          <MessageContent>
                            <Bubble align="end">
                              <BubbleContent className="whitespace-pre-wrap">
                                {turn.text}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <ReceptionistMessage>{turn.reply}</ReceptionistMessage>
                      </div>
                    </MessageScrollerItem>
                  ))}
                  {busy && (
                    <MessageScrollerItem messageId="busy">
                      <ReceptionistMessage>
                        <span
                          role="status"
                          className="flex items-center gap-2 text-muted-foreground"
                        >
                          <Spinner aria-hidden="true" />
                          {token ? "Thinking…" : "Connecting…"}
                        </span>
                      </ReceptionistMessage>
                    </MessageScrollerItem>
                  )}
                  {connectFailed && (
                    <MessageScrollerItem messageId="error">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => {
                          started.current = true;
                          void startConversation();
                        }}
                      >
                        Try connecting again
                      </Button>
                    </MessageScrollerItem>
                  )}
                  <BookingResult
                    state={state}
                    busy={busy}
                    consent={consent}
                    setConsent={setConsent}
                    send={send}
                  />
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
          {!state.receipt && (
            <ChatComposer
              text={text}
              setText={setText}
              busy={busy}
              disabled={!token}
              sendMessage={sendMessage}
            />
          )}
        </>
      )}
    </section>
  );
}
