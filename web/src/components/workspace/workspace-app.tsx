"use client";
import { dashboardNotifications } from "@/app/dashboard/read-actions";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { floatingSheetClassName } from "@/components/ui/sheet-styles";
import { authClient } from "@/lib/auth-client";
import type { Catalog } from "@/lib/domain/bookings/contract";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import type {
  WorkspaceDashboardData,
  WorkspaceMembership,
} from "@/features/workspaces/types";
import { BellIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
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
  data: Data;
  catalog: Catalog | null;
  section: DashboardSection;
  aiConfigured: boolean;
  now: string;
  publicAppOrigin: string;
}) {
  const [notifications, setNotifications] = useState<
    Data["notifications"] | null
  >(section === "Notifications" ? data.notifications : null);
  const [notificationError, setNotificationError] = useState(false);
  const loadingNotifications = useRef(false);
  async function loadNotifications() {
    if (loadingNotifications.current) return;
    loadingNotifications.current = true;
    setNotificationError(false);
    try {
      setNotifications(await dashboardNotifications(data.workspace.id));
    } catch {
      setNotificationError(true);
    } finally {
      loadingNotifications.current = false;
    }
  }
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
  const [editor, setEditor] = useState<EditorKind>(null);
  const [recordId, setRecordId] = useState("");
  const w = data.workspace;
  const owner = data.role === "owner";
  const service = data.services.find((s) => s.id === recordId);
  const nav = (name: DashboardSection, id = w.id) => {
    router.push(dashboardHref(name, id));
  };

  const open = (kind: NonNullable<typeof editor>, id = "") => {
    setRecordId(id);
    setEditor(kind);
  };

  const fields = getEditorFields({
    editor,
    service,
    data,
    recordId,
    user,
  });

  const { mutate, save, resendInvite } = createWorkspaceAppActions({
    workspaceId: w.id,
    data,
    editor,
    recordId,
    refresh: () => router.refresh(),
  });

  const money = (v: number) => formatCurrency(v, w.currency);

  const accountMenu = (
    <AccountMenu
      name={user.name}
      email={user.email}
      onProfile={() => {
        if (owner)
          router.push(`${dashboardHref("Settings", w.id)}&tab=profile`);
        else open("account");
      }}
      onSignOut={async () => {
        const result = await authClient.signOut();
        if (result.error) {
          toast.add({ title: "Could not sign out. Try again.", type: "error" });

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
      activeId={w.id}
      activeLogo={w.logo}
      onSwitch={(id) => nav("Overview", id)}
      createHref="/onboarding?new=true"
    />
  );
  const bellPanel = owner ? (
    <Sheet
      onOpenChange={(open) => {
        if (open) void loadNotifications();
      }}
    >
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Notifications" />
        }
      >
        <BellIcon />
      </SheetTrigger>
      <SheetContent side="right" className={floatingSheetClassName}>
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col divide-y">
            {notificationError ? (
              <p className="px-4 py-6 text-sm">
                Could not load notifications.{" "}
                <Button
                  variant="outline"
                  onClick={() => void loadNotifications()}
                >
                  Try again
                </Button>
              </p>
            ) : notifications === null ? (
              <p className="px-4 py-6 text-sm" role="status">
                Loading notifications…
              </p>
            ) : notifications.length === 0 ? (
              <p className="flex min-h-48 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              notifications.slice(0, 20).map((n) => (
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
    editor,
    setEditor,
    recordId,
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
