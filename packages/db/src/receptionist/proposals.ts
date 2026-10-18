import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../connection";
import { appointments, mcpBookingProposals, workspaces } from "../schema";
import type { ExternalBookingProposal } from "@welio/domain/receptionist/contract";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function purgeExpiredProposals(db: Database, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE mcp_booking_proposals AS proposal
      SET confirmed_appointment_id = appointment.id,
          proposal = NULL,
          confirmation_lease = NULL,
          confirmation_lease_until = NULL
      FROM appointments AS appointment
      WHERE proposal.confirmed_appointment_id IS NULL
        AND proposal.proposal IS NOT NULL
        AND proposal.expires_at <= ${now}
        AND (proposal.confirmation_lease_until IS NULL OR proposal.confirmation_lease_until <= ${now})
        AND appointment.workspace_id = proposal.workspace_id
        AND appointment.idempotency_key = proposal.idempotency_key
    `);
    await tx
      .delete(mcpBookingProposals)
      .where(
        and(
          lte(mcpBookingProposals.expiresAt, now),
          isNull(mcpBookingProposals.confirmedAppointmentId),
          or(
            isNull(mcpBookingProposals.confirmationLeaseUntil),
            lte(mcpBookingProposals.confirmationLeaseUntil, now),
          ),
        ),
      );
  });
}

export async function saveProposal(
  db: Database,
  workspaceId: string,
  proposal: ExternalBookingProposal,
) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(mcpBookingProposals).values({
    id: proposal.id,
    workspaceId,
    idempotencyKey: proposal.input.key,
    approvalTokenHash: hashToken(token),
    proposal,
    expiresAt: new Date(proposal.expiresAt),
  });

  return token;
}

export type ProposalClaim =
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "busy" }
  | { status: "confirmed"; appointmentId: string }
  | {
      status: "claimed";
      proposal: ExternalBookingProposal;
      lease: string;
    };

export async function claimProposal(
  db: Database,
  slug: string,
  proposalId: string,
  token: string,
  now = new Date(),
): Promise<ProposalClaim> {
  return db.transaction(async (tx): Promise<ProposalClaim> => {
    const [row] = await tx
      .select({
        proposal: mcpBookingProposals.proposal,
        workspaceId: mcpBookingProposals.workspaceId,
        idempotencyKey: mcpBookingProposals.idempotencyKey,
        expiresAt: mcpBookingProposals.expiresAt,
        appointmentId: mcpBookingProposals.confirmedAppointmentId,
        leaseUntil: mcpBookingProposals.confirmationLeaseUntil,
      })
      .from(mcpBookingProposals)
      .innerJoin(workspaces, eq(workspaces.id, mcpBookingProposals.workspaceId))
      .where(
        and(
          eq(mcpBookingProposals.id, proposalId),
          eq(mcpBookingProposals.approvalTokenHash, hashToken(token)),
          eq(workspaces.slug, slug),
          eq(workspaces.isPublished, true),
        ),
      )
      .for("update", { of: mcpBookingProposals });

    if (!row) return { status: "invalid" };

    if (row.appointmentId)
      return { status: "confirmed", appointmentId: row.appointmentId };

    if (row.leaseUntil && row.leaseUntil > now) return { status: "busy" };

    const [committed] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, row.workspaceId),
          eq(appointments.idempotencyKey, row.idempotencyKey),
        ),
      );

    if (committed) {
      await tx
        .update(mcpBookingProposals)
        .set({
          confirmedAppointmentId: committed.id,
          proposal: null,
          confirmationLease: null,
          confirmationLeaseUntil: null,
        })
        .where(eq(mcpBookingProposals.id, proposalId));

      return { status: "confirmed", appointmentId: committed.id };
    }

    if (row.expiresAt <= now) return { status: "expired" };

    if (!row.proposal) return { status: "invalid" };

    const lease = randomUUID();
    await tx
      .update(mcpBookingProposals)
      .set({
        confirmationLease: lease,
        confirmationLeaseUntil: new Date(now.getTime() + 120_000),
      })
      .where(eq(mcpBookingProposals.id, proposalId));

    return { status: "claimed", proposal: row.proposal, lease };
  });
}

export async function completeProposal(
  db: Database,
  proposalId: string,
  lease: string,
  appointmentId: string,
) {
  const [saved] = await db
    .update(mcpBookingProposals)
    .set({
      confirmedAppointmentId: appointmentId,
      proposal: null,
      confirmationLease: null,
      confirmationLeaseUntil: null,
    })
    .where(
      and(
        eq(mcpBookingProposals.id, proposalId),
        eq(mcpBookingProposals.confirmationLease, lease),
      ),
    )
    .returning({ id: mcpBookingProposals.id });

  return Boolean(saved);
}

export async function releaseProposalClaim(
  db: Database,
  proposalId: string,
  lease: string,
) {
  await db
    .update(mcpBookingProposals)
    .set({ confirmationLease: null, confirmationLeaseUntil: null })
    .where(
      and(
        eq(mcpBookingProposals.id, proposalId),
        eq(mcpBookingProposals.confirmationLease, lease),
      ),
    );
}
