import { DashboardPage } from "@/components/workspace/dashboard-page";
export const maxDuration = 60;
export const metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};
export default function Page({
  searchParams,
}: PageProps<"/dashboard/customers">) {
  return <DashboardPage section="Customers" searchParams={searchParams} />;
}
