import { Spinner } from "@/components/ui/spinner";
import { Suspense } from "react";
import { VerificationPending } from "@/components/auth/verification-pending";

export const metadata = {
  title: "Verify your email",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" />
          Loading…
        </div>
      }
    >
      <VerificationPending />
    </Suspense>
  );
}
