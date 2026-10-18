import { DashboardPage } from "@/components/workspace/dashboard-page";
export const maxDuration = 60;
export const metadata = {
  title: "Services",
  robots: { index: false, follow: false },
};
export default function Page({
  searchParams,
}: PageProps<"/dashboard/services">) {
  return <DashboardPage section="Services" searchParams={searchParams} />;
}
