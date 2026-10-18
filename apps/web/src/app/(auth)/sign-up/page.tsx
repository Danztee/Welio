import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <AuthShell>
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
