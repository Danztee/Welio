import { z } from "zod";

export const receptionistSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    greeting: z.string().trim().min(1).max(240),
    instructions: z.string().trim().max(2400),
    faqs: z
      .array(
        z.strictObject({
          question: z.string().trim().min(1).max(200),
          answer: z.string().trim().min(1).max(1000),
        }),
      )
      .max(12),
    allowAvailability: z.boolean(),
    allowBooking: z.boolean(),
  })
  .refine((settings) => !settings.allowBooking || settings.allowAvailability, {
    message: "Enable availability checks before allowing booking requests.",
    path: ["allowBooking"],
  });
export type ReceptionistSettings = z.infer<typeof receptionistSettingsSchema>;
export const defaultReceptionistSettings: ReceptionistSettings = {
  enabled: true,
  greeting: "Hello! How can I help you find a service or book an appointment?",
  instructions: "",
  faqs: [],
  allowAvailability: true,
  allowBooking: true,
};
