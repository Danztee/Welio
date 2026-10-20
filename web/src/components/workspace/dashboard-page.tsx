import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { requireUser, redirectToSessionRenewal } from "@/lib/auth/session";
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
  owner: boolean,
  returnTo: string,
) {
  try {
    const options = {
      cursor: params.cursor,
      search: params.search,
      status: z
        .enum(["confirmed", "completed", "cancelled", "no_show"])
        .optional()
        .parse(params.status || undefined),
      from: params.from,
      to: params.to,
    };
    return await Promise.all([
      getWorkspaceDashboard(selected, section, options),
      owner && section === "Appointments"
        ? getWorkspaceCatalog(selected)
        : null,
    ]);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    if (error instanceof BackendError && error.status === 401)
      redirectToSessionRenewal(returnTo);

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
  const returnTo =
    dashboardHref(section) + (returnParams.size ? `?${returnParams}` : "");
  const userPromise = requireUser(returnTo);
  const listPromise = listWorkspaces().catch(async (error) => {
    // Let authentication redirects win over errors from the parallel resource read.
    await userPromise;
    if (error instanceof BackendError && error.status === 401)
      redirectToSessionRenewal(returnTo);
    throw error;
  });
  const [user, list] = await Promise.all([userPromise, listPromise]);
  const selected =
    typeof params.workspace === "string"
      ? params.workspace
      : list[0]?.workspace.id;
  if (!selected) redirect("/onboarding");

  if (!z.uuid().safeParse(selected).success) notFound();

  const [data, catalog] = await loadWorkspace(
    selected,
    section,
    params,
    list.find((item) => item.workspace.id === selected)?.role === "owner",
    returnTo,
  );
  if (data.role === "owner" && !data.workspace.onboarded)
    redirect(`/onboarding?workspace=${selected}`);

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
