"use client";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import { SearchField } from "@/components/platform/search-field";
import { Button } from "@welio/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@welio/ui/components/sheet";
import { floatingSheetClassName } from "@welio/ui/components/sheet-styles";
import { authClient } from "@/lib/auth-client";
import type { Catalog } from "@welio/domain/bookings/contract";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import type {
  WorkspaceDashboardData,
  WorkspaceMembership,
} from "@/features/workspaces/types";
import { BellIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  getEditorFields,
  type WorkspaceEditorKind as EditorKind,
} from "./workspace-editor-fields";
import { createWorkspaceAppActions } from "./workspace-app-actions";
import {
  WorkspaceDashboardView,
  type WorkspaceAppUser as User,
  type WorkspaceRenderModel,
} from "./workspace-dashboard-view";

type Data = WorkspaceDashboardData;
type List = WorkspaceMembership[];

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
  }).format(value / 100);
}

export function WorkspaceApp({
  user,
  list,
  data,
  catalog,
  section,
  aiConfigured,
  now,
  publicAppOrigin,
}: {
  user: User;
  list: List;
  data: Data | null;
  catalog: Catalog | null;
  section: DashboardSection;
  aiConfigured: boolean;
  now: string;
  publicAppOrigin: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const settingsTab =
    requestedTab === "business" ||
    requestedTab === "booking-page" ||
    requestedTab === "booking" ||
    requestedTab === "security"
      ? requestedTab
      : "profile";
  const [searches, setSearches] = useState<Record<string, string>>({});
  const query = searches[section] ?? "";
  const matches = (...values: (string | null | undefined)[]) =>
    values.join(" ").toLowerCase().includes(query.toLowerCase());
  const searchToolbar = (
    <SearchField
      label={`Search ${section.toLowerCase()}`}
      value={query}
      onChange={(value) =>
        setSearches((current) => ({
          ...current,
          [section]: value,
        }))
      }
    />
  );
  const [editor, setEditor] = useState<EditorKind>(null);
  const [recordId, setRecordId] = useState("");
  const [revoke, setRevoke] = useState<{
    target: string;
    kind: "member" | "invitation";
  } | null>(null);
  const w = data?.workspace;
  const owner = data?.role === "owner";
  const service = data?.services.find((s) => s.id === recordId);
  const worker = data?.staff.find((s) => s.id === recordId);
  const nav = (name: DashboardSection, id = w?.id) => {
    router.push(dashboardHref(name, id));
  };

  const open = (kind: NonNullable<typeof editor>, id = "") => {
    setRecordId(id);
    setEditor(kind);
  };

  const fields = getEditorFields({
    editor,
    service,
    worker,
    workspace: w,
    data,
    recordId,
    user,
  });

  const { mutate, save, resendInvite } = createWorkspaceAppActions({
    workspaceId: w?.id ?? "",
    data,
    editor,
    recordId,
    refresh: () => router.refresh(),
  });

  const money = (v: number) => formatCurrency(v, w?.currency ?? "NGN");

  const accountMenu = (
    <AccountMenu
      name={user.name}
      email={user.email}
      onProfile={() => {
        if (owner)
          router.push(
            `${dashboardHref("Settings", w?.id)}${w?.id ? "&" : "?"}tab=profile`,
          );
        else open("account");
      }}
      onSignOut={async () => {
        const result = await authClient.signOut();
        if (result.error) {
          toast.error("Could not sign out. Try again.");

          return;
        }

        router.push("/sign-in");
        router.refresh();
      }}
    />
  );
  const picker = (
    <WorkspaceSwitcher
      workspaces={list.map((x) => x.workspace)}
      activeId={w?.id ?? ""}
      activeLogo={w?.logo ?? null}
      onSwitch={(id) => nav("Overview", id)}
      createHref="/onboarding?new=true"
    />
  );
  const bellPanel =
    owner && data ? (
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Notifications" />
          }
        >
          <BellIcon />
        </SheetTrigger>
        <SheetContent side="right" className={floatingSheetClassName}>
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col divide-y">
              {data.notifications.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No notifications yet.
                </p>
              ) : (
                data.notifications
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((n) => (
                    <div key={n.id} className="flex flex-col gap-1 px-4 py-3">
                      <p className="text-sm leading-snug font-medium">
                        {n.subject}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.recipient} ·{" "}
                        {n.kind === "reminder" ? "Reminder" : "Booking update"}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {n.status}
                        {n.attempts > 1 ? ` · ${n.attempts} attempts` : ""}
                      </p>
                    </div>
                  ))
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    ) : null;
  const model: WorkspaceRenderModel = {
    user,
    data,
    catalog,
    section,
    aiConfigured,
    now,
    publicAppOrigin,
    settingsTab,
    matches,
    searchToolbar,
    editor,
    setEditor,
    recordId,
    revoke,
    setRevoke,
    w,
    owner,
    service,
    open,
    mutate,
    fields,
    save,
    money,
    resendInvite,
    accountMenu,
    picker,
    bellPanel,
  };

  return <WorkspaceDashboardView model={model} />;
}
