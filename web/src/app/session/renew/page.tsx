import { SessionRenewal } from "./renewal";
import { safeReturnPath } from "@/lib/auth-path";

export const metadata = {
  title: "Restoring your session",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <SessionRenewal next={safeReturnPath((await searchParams).next ?? null)} />
  );
}
