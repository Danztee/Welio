import { z } from "zod";
import {
  bookingInput,
  bookingProposalInput,
  serviceAddressInput,
  serviceLocationInput,
  slotInput,
} from "../bookings/contract";
import { BookingLocation } from "../workspaces/enums";

const proposalBaseInput = bookingInput.omit({
  key: true,
  quote: true,
  consent: true,
  address: true,
  serviceLocation: true,
});

export function proposalInputForLocation(location: BookingLocation) {
  return proposalBaseInput.extend({
    ...(location === BookingLocation.Both
      ? {
          serviceLocation: serviceLocationInput.describe(
            "Choose customer_address or business_address for this appointment.",
          ),
        }
      : {}),
    address:
      location === BookingLocation.CustomerAddress
        ? serviceAddressInput
        : serviceAddressInput
            .optional()
            .describe(
              "Required when serviceLocation is customer_address; omit for business_address.",
            ),
  });
}

export const proposalInput = proposalInputForLocation(
  BookingLocation.CustomerAddress,
);

export const availabilityInput = slotInput;

export type Proposal = {
  id: string;
  expiresAt: string;
  input: z.infer<typeof bookingProposalInput>;
  service: string;
  staff: string;
  priceMinor: number;
  currency: string;
  timeZone: string;
  cancelHours: number;
};

export type ExternalBookingProposal = Omit<Proposal, "input"> & {
  input: Omit<Proposal["input"], "consent">;
};

export const externalBookingConfirmationInput = z.strictObject({
  proposalId: z.uuid().describe("The proposal ID returned by prepare_booking."),
  confirmationToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .describe("The private token returned with the proposal."),
  customerApproved: z
    .literal(true)
    .describe(
      "Set true only after the customer explicitly approves the exact booking details.",
    ),
  emailConsent: z
    .literal(true)
    .describe(
      "Set true only after the customer explicitly agrees to booking emails.",
    ),
});

export const proposalSchema: z.ZodType<Proposal> = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime(),
  input: bookingProposalInput,
  service: z.string(),
  staff: z.string(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string(),
  timeZone: z.string(),
  cancelHours: z.number(),
});
