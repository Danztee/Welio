import { DashboardPage } from "@/components/workspace/dashboard-page";
export const maxDuration = 60;
export const metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};
export default function Page({
  searchParams,
}: PageProps<"/dashboard/settings">) {
  return <DashboardPage section="Settings" searchParams={searchParams} />;
}
