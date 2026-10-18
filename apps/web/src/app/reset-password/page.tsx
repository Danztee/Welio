import { Spinner } from "@welio/ui/components/spinner";
import { Suspense } from "react";
import { AccountFlow } from "@/components/auth/account-flows";

export const metadata = {
  title: "Welio account",
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
      <AccountFlow mode="reset-password" />
    </Suspense>
  );
}
