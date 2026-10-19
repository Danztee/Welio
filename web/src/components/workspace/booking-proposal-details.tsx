import type { Proposal } from "@/lib/domain/receptionist/contract";
import { formatMoney } from "./booking-format";

export function BookingProposalDetails({ proposal }: { proposal: Proposal }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Service</dt>
      <dd>{proposal.service}</dd>
      <dt className="text-muted-foreground">When</dt>
      <dd>
        {proposal.input.date} at {proposal.input.time} ({proposal.timeZone})
      </dd>
      <dt className="text-muted-foreground">Team member</dt>
      <dd>{proposal.staff}</dd>
      <dt className="text-muted-foreground">Price</dt>
      <dd>{formatMoney(proposal.priceMinor, proposal.currency)}</dd>
      <dt className="text-muted-foreground">Customer</dt>
      <dd>{proposal.input.name}</dd>
      <dt className="text-muted-foreground">Email</dt>
      <dd className="break-all">{proposal.input.email}</dd>
      <dt className="text-muted-foreground">Phone</dt>
      <dd>{proposal.input.phone || "Not provided"}</dd>
      <dt className="text-muted-foreground">Appointment location</dt>
      <dd className="break-words">{proposal.input.address}</dd>
    </dl>
  );
}
