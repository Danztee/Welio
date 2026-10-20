"use client";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { type ReactNode } from "react";
import { SparklesIcon } from "lucide-react";
import type { ReceptionistActivity } from "@/lib/domain/receptionist/contract";

const activityLabels: Record<ReceptionistActivity, string> = {
  thinking: "Thinking",
  checking_services: "Checking services",
  checking_availability: "Checking availability",
  preparing_booking: "Preparing booking",
  writing: "Writing a reply",
};

const markdownComponents: Components = {
  p: ({ children }) => <p className="leading-6">{children}</p>,
  h1: ({ children }) => (
    <h1 className="text-base leading-6 font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm leading-6 font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm leading-6 font-semibold">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={className ?? "rounded bg-muted px-1 py-0.5 font-mono text-xs"}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b px-2 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-2 py-1.5">{children}</td>,
  hr: () => <hr className="border-border" />,
};

function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm leading-6 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function ReceptionistMessage({
  children,
  activity,
}: {
  children: ReactNode;
  activity?: ReceptionistActivity | null;
}) {
  const content =
    typeof children === "string" ? (
      <ChatMarkdown>{children}</ChatMarkdown>
    ) : (
      children
    );

  return (
    <Message className="items-end">
      <MessageContent className="max-w-full gap-1">
        <MessageHeader className="px-1 text-xs">Receptionist</MessageHeader>
        <Bubble variant="outline" className="max-w-full">
          <BubbleContent className="min-w-0 rounded-2xl rounded-bl-md px-3.5 py-2.5">
            {content}
            {activity && (
              <span
                role="status"
                aria-live="polite"
                className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground"
              >
                <SparklesIcon
                  aria-hidden="true"
                  className="size-3.5 text-primary motion-safe:animate-pulse motion-reduce:animate-none"
                />
                <span>{activityLabels[activity]}</span>
                <span aria-hidden="true" className="flex items-center gap-0.5">
                  {[0, 120, 240].map((delay) => (
                    <span
                      key={delay}
                      style={{ animationDelay: `${delay}ms` }}
                      className="size-1 rounded-full bg-primary motion-safe:animate-pulse motion-reduce:animate-none"
                    />
                  ))}
                </span>
              </span>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
