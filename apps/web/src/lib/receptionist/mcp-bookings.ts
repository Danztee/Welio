import "server-only";

import type { Database } from "@welio/db/connection";
import {
  claimProposal,
  completeProposal,
  purgeExpiredProposals,
  releaseProposalClaim,
  saveProposal,
} from "@welio/db/receptionist/proposals";
import { createBooking } from "@welio/db/bookings";
import { BookingError } from "@welio/domain/bookings/errors";
import type { ExternalBookingProposal } from "@welio/domain/receptionist/contract";

export async function purgeExpiredMcpBookingProposals(
  db: Database,
  now = new Date(),
) {
  return purgeExpiredProposals(db, now);
}

export async function createMcpBookingProposal(
  db: Database,
  workspaceId: string,
  proposal: ExternalBookingProposal,
) {
  return saveProposal(db, workspaceId, proposal);
}

export async function confirmMcpBookingProposal(
  db: Database,
  slug: string,
  input: {
    proposalId: string;
    confirmationToken: string;
    customerApproved: true;
    emailConsent: true;
  },
  origin: string,
  now = new Date(),
) {
  const claim = await claimProposal(
    db,
    slug,
    input.proposalId,
    input.confirmationToken,
    now,
  );

  if (claim.status === "invalid")
    throw new BookingError(
      "This booking proposal is invalid or unavailable.",
      "not_found",
    );

  if (claim.status === "expired")
    throw new BookingError(
      "This proposal expired. Prepare a new booking and review it again.",
    );

  if (claim.status === "busy")
    throw new BookingError(
      "This booking confirmation is already in progress. Retry shortly.",
    );

  if (claim.status === "confirmed")
    return { appointmentId: claim.appointmentId, status: "confirmed" as const };

  try {
    const booking = await createBooking(
      db,
      { slug },
      { ...claim.proposal.input, consent: true },
      origin,
      now,
      "receptionist",
    );
    const saved = await completeProposal(
      db,
      input.proposalId,
      claim.lease,
      booking.id,
    );
    if (!saved)
      throw new BookingError(
        "The booking was saved. Retry confirmation to retrieve its result.",
        "unavailable",
      );

    return { appointmentId: booking.id, status: "confirmed" as const };
  } catch (error) {
    await releaseProposalClaim(db, input.proposalId, claim.lease);
    throw error;
  }
}
