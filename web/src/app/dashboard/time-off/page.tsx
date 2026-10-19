import {
  DashboardPage,
  type DashboardSearchParams,
} from "@/components/workspace/dashboard-page";

export const metadata = {
  title: "Time off",
  robots: { index: false, follow: false },
};

export default function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  return <DashboardPage section="Time off" searchParams={searchParams} />;
}
