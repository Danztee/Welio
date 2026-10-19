"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";

export function ListControls({
  data,
  section,
}: {
  data: WorkspaceDashboardData;
  section: DashboardSection;
}) {
  const params = useSearchParams();
  const page = data.pagination;
  if (!page) return null;
  const path = dashboardHref(section, data.workspace.id);
  const next = new URLSearchParams({
    workspace: data.workspace.id,
    cursor: page.nextCursor,
  });
  if (page.search) next.set("search", page.search);
  if (page.from) next.set("from", page.from);
  if (page.to) next.set("to", page.to);
  return (
    <div className="flex flex-col gap-3">
      <form
        action={path.split("?")[0]}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="workspace" value={data.workspace.id} />
        <label className="flex flex-col gap-1 text-sm">
          Search all {section.toLowerCase()}
          <Input name="search" defaultValue={page.search} maxLength={200} />
        </label>
        {section === "Appointments" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              From
              <Input name="from" type="date" defaultValue={page.from} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <Input name="to" type="date" defaultValue={page.to} />
            </label>
          </>
        )}
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
      </form>
      <nav
        aria-label={`${section} pages`}
        className="flex flex-wrap items-center gap-3 text-sm"
      >
        <span>
          {page.total} matching {section.toLowerCase()}
        </span>
        {params.has("cursor") && (
          <Link
            href={
              path +
              (page.search
                ? `&search=${encodeURIComponent(page.search)}`
                : "") +
              (page.from ? `&from=${page.from}` : "") +
              (page.to ? `&to=${page.to}` : "")
            }
          >
            First page
          </Link>
        )}
        {page.nextCursor && (
          <Link href={`${path.split("?")[0]}?${next}`}>Next page</Link>
        )}
      </nav>
    </div>
  );
}
