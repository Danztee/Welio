import { authClient } from "@/lib/auth-client";

export type Mode = "forgot-password" | "reset-password";

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
      "Use at least 8 characters. Your other sessions will be signed out.",
    submit: "Reset password",
    success: "Password updated.",
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

  return authClient.resetPassword({
    newPassword: String(data.get("password")),
    token,
  });
}
