import { DashboardPage } from "@/components/workspace/dashboard-page";

export const maxDuration = 60;

export const metadata = {
  title: "Appointments",
  robots: { index: false, follow: false },
};

export default function Page({
  searchParams,
}: PageProps<"/dashboard/appointments">) {
  return <DashboardPage section="Appointments" searchParams={searchParams} />;
}
