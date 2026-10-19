import { authClient } from "@/lib/auth-client";

export type Mode = "forgot-password" | "reset-password" | "verify-email";

export const copy = {
  "forgot-password": {
    title: "Reset your password",
    description: "We’ll email you a link to reset your password.",
    submit: "Send reset link",
    success: "Password reset link sent.",
  },
  "reset-password": {
    title: "Choose a new password",
    description:
      "Use at least 12 characters. Your other sessions will be signed out.",
    submit: "Reset password",
    success: "Password updated.",
  },
  "verify-email": {
    title: "Check your email",
    description:
      "Open the verification email to confirm your address, then continue to your workspace.",
    submit: "Resend verification email",
    success: "Verification email sent.",
  },
} satisfies Record<
  Mode,
  { title: string; description: string; submit: string; success: string }
>;

export async function submitRequest(mode: Mode, data: FormData, token: string) {
  if (mode === "forgot-password")
    return authClient.requestPasswordReset({
      email: String(data.get("email")),
    });

  if (mode === "reset-password")
    return authClient.resetPassword({
      newPassword: String(data.get("password")),
      token,
    });

  return authClient.sendVerificationEmail({
    email: String(data.get("email")),
  });
}
