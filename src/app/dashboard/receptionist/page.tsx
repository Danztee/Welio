import { DashboardPage } from "@/components/workspace/dashboard-page";
export const maxDuration = 60;
export const metadata = {
  title: "Receptionist",
  robots: { index: false, follow: false },
};
export default function Page({
  searchParams,
}: PageProps<"/dashboard/receptionist">) {
  return <DashboardPage section="Receptionist" searchParams={searchParams} />;
}
