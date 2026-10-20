import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getWorkspaceDashboard,
  listWorkspaces,
} from "@/features/workspaces/queries";
import { BackendError } from "@/lib/backend/server-api";
import { WorkspaceOnboarding } from "@/components/workspace/onboarding";
import type { WorkspaceMembership } from "@/features/workspaces/types";

type OnboardingParams = Awaited<PageProps<"/onboarding">["searchParams"]>;

function returnTo(params: OnboardingParams) {
  if (params.new === "true") return "/onboarding?new=true";
  if (typeof params.workspace === "string")
    return `/onboarding?workspace=${encodeURIComponent(params.workspace)}`;

  return "/onboarding";
}

function selectedWorkspace(
  params: OnboardingParams,
  workspaces: WorkspaceMembership[],
) {
  if (typeof params.workspace === "string") return params.workspace;
  if (params.new === "true") return undefined;

  return workspaces.find(
    (item) => item.role === "owner" && !item.workspace.onboarded,
  )?.workspace.id;
}

async function loadSetup(selected: string) {
  try {
    return await getWorkspaceDashboard(selected);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();

    throw error;
  }
}

export const metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  const user = await requireUser(returnTo(params));
  const list = await listWorkspaces();
  const selected = selectedWorkspace(params, list);
  if (!selected) {
    if (list.length && params.new !== "true") redirect("/dashboard");

    return <WorkspaceOnboarding key="new" user={user} data={null} />;
  }

  if (!z.uuid().safeParse(selected).success) notFound();

  const data = await loadSetup(selected);

  if (data.role !== "owner" || data.workspace.onboarded)
    redirect(`/dashboard?workspace=${selected}`);

  return <WorkspaceOnboarding key={selected} user={user} data={data} />;
}
