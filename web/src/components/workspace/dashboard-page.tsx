import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import {
  dashboardHref,
  dashboardRoutes,
  type DashboardSection,
} from "@/lib/dashboard-routes";
import {
  getWorkspaceCatalog,
  getWorkspaceDashboard,
  listWorkspaces,
} from "@/features/workspaces/queries";
import { BackendError } from "@/lib/backend/server-api";
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

async function loadWorkspace(selected: string) {
  try {
    return await getWorkspaceDashboard(selected);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();

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
  const list = await listWorkspaces();
  const selected =
    typeof params.workspace === "string"
      ? params.workspace
      : list[0]?.workspace.id;
  if (!selected) redirect("/onboarding");

  if (!z.uuid().safeParse(selected).success) notFound();

  const data = await loadWorkspace(selected);
  if (data.role === "owner" && !data.workspace.onboarded)
    redirect(`/onboarding?workspace=${selected}`);

  const catalog =
    data.role === "owner" ? await getWorkspaceCatalog(selected) : null;
  const now = new Date().toISOString();

  return (
    <WorkspaceApp
      key={selected}
      aiConfigured={data.workspace.receptionistSettings.enabled}
      now={now}
      section={section}
      user={user}
      list={list}
      data={data}
      catalog={catalog}
      publicAppOrigin={new URL(env.APP_URL).origin}
    />
  );
}
