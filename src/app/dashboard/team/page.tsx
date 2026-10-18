import { DashboardPage } from "@/components/workspace/dashboard-page";
export const maxDuration = 60;
export const metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};
export default function Page({ searchParams }: PageProps<"/dashboard/team">) {
  return <DashboardPage section="Team" searchParams={searchParams} />;
}
