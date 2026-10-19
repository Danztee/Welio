import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
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
  tab?: string;
  cursor?: string;
  search?: string;
  status?: string;
  from?: string;
  to?: string;
}>;

async function loadWorkspace(
  selected: string,
  section: DashboardSection,
  params: Awaited<DashboardSearchParams>,
) {
  try {
    return await getWorkspaceDashboard(selected, section, {
      cursor: params.cursor,
      search: params.search,
      status: z
        .enum(["confirmed", "completed", "cancelled", "no_show"])
        .optional()
        .parse(params.status || undefined),
      from: params.from,
      to: params.to,
    });
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
  const returnParams = new URLSearchParams();
  for (const key of [
    "workspace",
    "tab",
    "cursor",
    "search",
    "status",
    "from",
    "to",
  ] as const) {
    const value = params[key];
    if (typeof value === "string") returnParams.set(key, value);
  }
  const user = await requireUser(
    dashboardHref(section) + (returnParams.size ? `?${returnParams}` : ""),
  );
  const list = await listWorkspaces();
  const selected =
    typeof params.workspace === "string"
      ? params.workspace
      : list[0]?.workspace.id;
  if (!selected) redirect("/onboarding");

  if (!z.uuid().safeParse(selected).success) notFound();

  const data = await loadWorkspace(selected, section, params);
  if (data.role === "owner" && !data.workspace.onboarded)
    redirect(`/onboarding?workspace=${selected}`);

  const catalog =
    data.role === "owner" && section === "Appointments"
      ? await getWorkspaceCatalog(selected)
      : null;
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
