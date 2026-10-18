import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { getDatabase } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getCatalog } from "@/lib/bookings/repository";
import {
  dashboardHref,
  dashboardRoutes,
  type DashboardSection,
} from "@/lib/dashboard-routes";
import { aiConfigured } from "@/lib/receptionist/provider";
import {
  listWorkspaces,
  workspaceDetail,
  WorkspaceError,
} from "@/lib/workspaces/repository";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
export type DashboardSearchParams = Promise<{
  workspace?: string | string[];
  section?: string | string[];
}>;

function redirectLegacySection(
  params: Awaited<DashboardSearchParams>,
  section: DashboardSection,
) {
  if (section !== "Overview" || typeof params.section !== "string") return;
  const oldSection = Object.keys(dashboardRoutes).find(
    (name) => name.toLowerCase() === params.section?.toString().toLowerCase(),
  );
  const workspace =
    typeof params.workspace === "string" ? params.workspace : undefined;
  if (oldSection)
    redirect(dashboardHref(oldSection as DashboardSection, workspace));
  if (params.section === "Setup") redirect("/onboarding");
}

async function loadWorkspace(userId: string, selected: string) {
  try {
    return await workspaceDetail(getDatabase(), userId, selected);
  } catch (error) {
    if (error instanceof WorkspaceError) notFound();
    throw error;
  }
}

export async function DashboardPage({
  searchParams,
  section = "Overview",
}: {
  searchParams: DashboardSearchParams;
  section?: DashboardSection;
}) {
  const params = await searchParams;
  const user = await requireUser(
    dashboardHref(
      section,
      typeof params.workspace === "string" ? params.workspace : undefined,
    ),
  );
  redirectLegacySection(params, section);
  const list = await listWorkspaces(getDatabase(), user.id);
  const selected =
    typeof params.workspace === "string"
      ? params.workspace
      : list[0]?.workspace.id;
  if (!selected) redirect("/onboarding");
  if (!z.uuid().safeParse(selected).success) notFound();
  const data = await loadWorkspace(user.id, selected);
  if (data.role === "owner" && !data.workspace.onboarded)
    redirect(`/onboarding?workspace=${selected}`);
  const catalog =
    data.role === "owner"
      ? await getCatalog(getDatabase(), {
          userId: user.id,
          workspaceId: selected,
        })
      : null;
  const now = new Date().toISOString();
  return (
    <WorkspaceApp
      key={selected}
      aiConfigured={aiConfigured()}
      now={now}
      section={section}
      user={user}
      list={list}
      data={data}
      catalog={catalog}
    />
  );
}
