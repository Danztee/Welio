"use client";

import { z } from "zod";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  chatStartResponseSchema,
  chatStateSchema,
  chatSummarySchema,
  type ChatState,
  type ReceptionistActivity,
} from "@welio/domain/receptionist/contract";
import { Spinner } from "@welio/ui/components/spinner";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@welio/ui/components/message-scroller";
import { Message, MessageContent } from "@welio/ui/components/message";
import { Button } from "@welio/ui/components/button";
import { Bubble, BubbleContent } from "@welio/ui/components/bubble";
import { Notice } from "@/components/platform/shared";
import { BookingResult } from "./booking-result";
import { ChatComposer } from "./chat-composer";
import { ReceptionistConversationHeader } from "./receptionist-conversation-header";
import { ReceptionistMessage } from "./receptionist-message";
import { ReceptionistQuickActions } from "./receptionist-quick-actions";
import { empty } from "./receptionist-chat-shared";
import { readReceptionistStream } from "@/lib/receptionist/stream-client";
import { ReceptionistConversationList } from "./receptionist-conversation-list";

const retryDraftSchema = z.object({
  key: z.uuid(),
  text: z.string().min(1).max(1600),
  savedAt: z.number(),
});

function retryDraftStorageKey(slug: string, conversationId: string) {
  return `welio:chat-retry:${slug}:${conversationId}`;
}

function activeConversationStorageKey(slug: string) {
  return `welio:active-chat:${slug}`;
}

function readActiveConversation(slug: string) {
  try {
    return (
      localStorage.getItem(activeConversationStorageKey(slug)) ?? undefined
    );
  } catch {
    return undefined;
  }
}

function saveActiveConversation(slug: string, conversationId: string) {
  try {
    localStorage.setItem(activeConversationStorageKey(slug), conversationId);
  } catch {
    // The latest server-side conversation still resumes when storage is unavailable.
  }
}

function recoverRetryDraft(
  slug: string,
  conversationId: string,
  state: ChatState,
): ChatState {
  const storageKey = retryDraftStorageKey(slug, conversationId);
  try {
    const serialized = sessionStorage.getItem(storageKey);
    if (!serialized) return state;

    const saved = retryDraftSchema.safeParse(JSON.parse(serialized));
    if (!saved.success || Date.now() - saved.data.savedAt > 60 * 60_000) {
      sessionStorage.removeItem(storageKey);

      return state;
    }

    if (
      state.retry ||
      state.turns.some((turn) => turn.key === saved.data.key)
    ) {
      sessionStorage.removeItem(storageKey);

      return state;
    }

    return { ...state, retry: { key: saved.data.key, text: saved.data.text } };
  } catch {
    return state;
  }
}

function saveRetryDraft(
  slug: string,
  conversationId: string,
  key: string,
  text: string,
) {
  try {
    sessionStorage.setItem(
      retryDraftStorageKey(slug, conversationId),
      JSON.stringify({ key, text, savedAt: Date.now() }),
    );
  } catch {
    // Server-side session recovery remains available if browser storage is unavailable.
  }
}

function clearRetryDraft(slug: string, conversationId: string) {
  try {
    sessionStorage.removeItem(retryDraftStorageKey(slug, conversationId));
  } catch {
    // Ignore unavailable browser storage.
  }
}

export function ReceptionistChat({
  slug,
  businessName,
  logo,
  configured,
  greeting = "Hello! How can I help you today?",
}: {
  slug: string;
  businessName: string;
  logo: string | null;
  configured: boolean;
  greeting?: string;
}) {
  const [state, setState] = useState<ChatState>(empty);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    z.infer<typeof chatSummarySchema>[]
  >([]);
  const [showingMessages, setShowingMessages] = useState(false);
  const [text, setText] = useState("");
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [activity, setActivity] = useState<ReceptionistActivity | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "online" | "unavailable"
  >(() => (configured ? "connecting" : "unavailable"));
  const [consent, setConsent] = useState(false);
  const started = useRef(false);
  const attempt = useRef<{ text: string; key: string } | null>(null);

  async function refreshConversations() {
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (!response.ok) return;

      const data: unknown = await response.json();
      const parsed = z.array(chatSummarySchema).safeParse(data);
      if (parsed.success) setConversations(parsed.data);
    } catch {
      // The current conversation remains usable if the history refresh fails.
    }
  }

  const startConversation = useCallback(async () => {
    setBusy(true);
    setConnectionStatus("connecting");
    setConnectFailed(false);
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          conversationId: readActiveConversation(slug),
        }),
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

      const started = chatStartResponseSchema.parse(data);
      setConversationId(started.conversationId);
      saveActiveConversation(slug, started.conversationId);
      setConversations(started.conversations);
      setState(recoverRetryDraft(slug, started.conversationId, started.state));
      setConnectionStatus("online");
    } catch (cause) {
      started.current = false;
      setConnectFailed(true);
      setConnectionStatus("unavailable");
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
    if (!conversationId) return false;

    setBusy(true);
    if (action.action === "message")
      setState((previous) => ({ ...previous, pending: null }));

    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, conversationId }),
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
      void refreshConversations();

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

  async function sendMessage(message: string, retryKey?: string) {
    const value = message.trim();
    if (!value || busy || connectionStatus !== "online" || !conversationId)
      return;

    if (retryKey) attempt.current = { text: value, key: retryKey };
    else if (attempt.current?.text !== value)
      attempt.current = { text: value, key: crypto.randomUUID() };

    saveRetryDraft(slug, conversationId, attempt.current.key, value);
    setBusy(true);
    setState((previous) => ({ ...previous, pending: null }));
    setActiveMessage(value);
    setStreamingReply("");
    setActivity("thinking");
    setText("");
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          conversationId,
          text: attempt.current.text,
          key: attempt.current.key,
        }),
      });
      const next = await readReceptionistStream(
        response,
        (delta) => setStreamingReply((previous) => previous + delta),
        chatStateSchema,
        setActivity,
      );
      setState(next);
      setConsent(false);
      setText("");
      attempt.current = null;
      clearRetryDraft(slug, conversationId);
      await refreshConversations();
    } catch (cause) {
      setState((previous) => ({
        ...previous,
        retry: { key: attempt.current!.key, text: value },
      }));
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Connection failed. Please retry.",
      );
    } finally {
      setActiveMessage(null);
      setStreamingReply("");
      setActivity(null);
      setBusy(false);
    }
  }

  async function showMessages() {
    if (busy) return;

    setShowingMessages(true);
    await refreshConversations();
  }

  async function startNewConversation() {
    if (busy) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "new" }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(data);
        throw new Error(
          message.success
            ? message.data.error
            : "Could not start a new conversation. Please retry.",
        );
      }

      const started = chatStartResponseSchema.parse(data);
      setConversationId(started.conversationId);
      saveActiveConversation(slug, started.conversationId);
      setConversations(started.conversations);
      setState(started.state);
      setText("");
      setConsent(false);
      attempt.current = null;
      setShowingMessages(false);
      setConnectionStatus("online");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not start a new conversation. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openConversation(id: string) {
    if (busy) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", conversationId: id }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(data);
        throw new Error(
          message.success
            ? message.data.error
            : "Could not open this conversation. Please retry.",
        );
      }

      const opened = z
        .object({ conversationId: z.uuid(), state: chatStateSchema })
        .parse(data);
      setConversationId(opened.conversationId);
      saveActiveConversation(slug, opened.conversationId);
      setState(recoverRetryDraft(slug, opened.conversationId, opened.state));
      setText("");
      setConsent(false);
      attempt.current = null;
      setShowingMessages(false);
      setConnectionStatus("online");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not open this conversation. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={`Conversation with ${businessName}`}
      className="flex h-full min-h-0 flex-col"
    >
      <ReceptionistConversationHeader
        businessName={businessName}
        logo={logo}
        status={connectionStatus}
        hasCloseButton
        conversationCount={conversations.length}
        showingMessages={showingMessages}
        onMessages={configured ? showMessages : undefined}
        onBack={() => setShowingMessages(false)}
        onNewConversation={startNewConversation}
        actionsDisabled={busy}
      />
      {!configured ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Notice tone="warning">
            The AI receptionist is not available yet. You can still book using
            the booking form.
          </Notice>
        </div>
      ) : showingMessages ? (
        <ReceptionistConversationList
          conversations={conversations}
          activeId={conversationId}
          onSelect={(id) => void openConversation(id)}
        />
      ) : (
        <>
          <MessageScrollerProvider autoScroll>
            <MessageScroller
              className="min-h-0 flex-1 bg-card"
              role="log"
              aria-label="Conversation messages"
              aria-live="polite"
            >
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-4 p-4 sm:p-5">
                  <MessageScrollerItem messageId="welcome">
                    <div className="flex flex-col gap-3">
                      <ReceptionistMessage>{greeting}</ReceptionistMessage>
                      {state.turns.length === 0 &&
                        connectionStatus === "online" &&
                        !busy && (
                          <ReceptionistQuickActions
                            disabled={busy}
                            onSelect={(message) => void sendMessage(message)}
                          />
                        )}
                    </div>
                  </MessageScrollerItem>
                  {state.turns.map((turn) => (
                    <MessageScrollerItem
                      key={turn.key}
                      messageId={turn.key}
                      scrollAnchor
                    >
                      <div className="flex flex-col gap-3">
                        <Message align="end">
                          <MessageContent className="max-w-[88%]">
                            <Bubble align="end" className="max-w-full">
                              <BubbleContent className="rounded-2xl rounded-br-md whitespace-pre-wrap">
                                {turn.text}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <ReceptionistMessage>{turn.reply}</ReceptionistMessage>
                      </div>
                    </MessageScrollerItem>
                  ))}
                  {state.retry && !activeMessage && (
                    <MessageScrollerItem
                      key={state.retry.key}
                      messageId={`retry-${state.retry.key}`}
                      scrollAnchor
                    >
                      <div className="flex flex-col gap-3">
                        <Message align="end">
                          <MessageContent className="max-w-[88%]">
                            <Bubble align="end" className="max-w-full">
                              <BubbleContent className="rounded-2xl rounded-br-md whitespace-pre-wrap">
                                {state.retry.text}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <div className="flex flex-col items-start gap-2 pl-9">
                          <p className="text-xs text-muted-foreground">
                            This reply did not finish. Retry your message to
                            continue.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void sendMessage(
                                state.retry!.text,
                                state.retry!.key,
                              )
                            }
                          >
                            {busy ? "Retrying…" : "Retry reply"}
                          </Button>
                        </div>
                      </div>
                    </MessageScrollerItem>
                  )}
                  {activeMessage && (
                    <MessageScrollerItem messageId="streaming" scrollAnchor>
                      <div className="flex flex-col gap-3">
                        <Message align="end">
                          <MessageContent className="max-w-[88%]">
                            <Bubble align="end" className="max-w-full">
                              <BubbleContent className="rounded-2xl rounded-br-md whitespace-pre-wrap">
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
                  {busy && !activeMessage && (
                    <MessageScrollerItem messageId="busy">
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
              disabled={connectionStatus !== "online" || Boolean(state.retry)}
              sendMessage={sendMessage}
              hideLabel
            />
          )}
        </>
      )}
    </section>
  );
}
