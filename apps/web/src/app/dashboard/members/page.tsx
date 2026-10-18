import { DashboardPage } from "@/components/workspace/dashboard-page";

export const maxDuration = 60;

export const metadata = {
  title: "Members",
  robots: { index: false, follow: false },
};

export default function Page({
  searchParams,
}: PageProps<"/dashboard/members">) {
  return <DashboardPage section="Members" searchParams={searchParams} />;
}
