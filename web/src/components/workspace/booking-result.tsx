"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { type ChatState } from "@/lib/domain/receptionist/contract";
import { BookingProposalDetails } from "./booking-proposal-details";
import { type SendAction } from "./receptionist-chat-shared";

export function BookingResult({
  state,
  busy,
  consent,
  setConsent,
  send,
}: {
  state: ChatState;
  busy: boolean;
  consent: boolean;
  setConsent: (value: boolean) => void;
  send: SendAction;
}) {
  if (state.receipt)
    return (
      <MessageScrollerItem messageId="receipt" scrollAnchor>
        <Card role="status">
          <CardHeader>
            <CardTitle>
              <h3>Appointment booked</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm">
              Reference:{" "}
              <span className="font-mono break-all">{state.receipt}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Your confirmation email includes a private link to reschedule or
              cancel.
            </p>
          </CardContent>
        </Card>
      </MessageScrollerItem>
    );

  const proposal = state.pending;
  if (!proposal) return null;

  return (
    <MessageScrollerItem messageId={proposal.id} scrollAnchor>
      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Review your appointment</h3>
          </CardTitle>
          <CardDescription>
            This time is not reserved. This proposal expires in 10 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <BookingProposalDetails proposal={proposal} />
          <Field orientation="horizontal">
            <Checkbox
              id="chat-booking-consent"
              checked={consent}
              disabled={busy}
              onCheckedChange={setConsent}
              className="mt-1"
            />
            <FieldLabel htmlFor="chat-booking-consent">
              I approve these details and agree to receive booking emails.
            </FieldLabel>
          </Field>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !consent}
            onClick={() =>
              void send({
                action: "confirm",
                proposalId: proposal.id,
                consent: true,
              })
            }
          >
            {busy ? "Please wait…" : "Confirm appointment"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void send({ action: "reject", proposalId: proposal.id })
            }
          >
            Change details
          </Button>
        </CardFooter>
      </Card>
    </MessageScrollerItem>
  );
}
