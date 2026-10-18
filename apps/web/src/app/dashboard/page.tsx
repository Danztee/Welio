import { DashboardPage } from "@/components/workspace/dashboard-page";

export const maxDuration = 60;

export const metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

export default function Page({ searchParams }: PageProps<"/dashboard">) {
  return <DashboardPage searchParams={searchParams} />;
}
