import { z } from "zod";

export const accountNamesSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Enter your first name.")
    .max(50, "Use 50 characters or fewer."),
  lastName: z
    .string()
    .trim()
    .min(1, "Enter your last name.")
    .max(50, "Use 50 characters or fewer."),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email address.").max(254, "Email is too long."),
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(128, "Use 128 characters or fewer."),
});

export const signUpSchema = signInSchema
  .extend(accountNamesSchema.shape)
  .extend({
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .max(128, "Use 128 characters or fewer."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don’t match.",
    path: ["confirmPassword"],
  });
