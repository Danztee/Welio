"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { SearchField } from "@/components/platform/search-field";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import { CalendarDaysIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function ListSearch({
  data,
  section,
}: {
  data: WorkspaceDashboardData;
  section: DashboardSection;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const currentSearch = params.get("search") ?? "";
  const [searchDraft, setSearchDraft] = useState({
    committed: currentSearch,
    value: currentSearch,
  });
  const value =
    searchDraft.committed === currentSearch ? searchDraft.value : currentSearch;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function updateSearch(nextValue: string) {
    setSearchDraft({ committed: currentSearch, value: nextValue });
    if (timer.current) clearTimeout(timer.current);

    const next = new URLSearchParams(params);
    const search = nextValue.trim();
    next.delete("cursor");
    if (search) next.set("search", search);
    else next.delete("search");
    next.set("workspace", data.workspace.id);

    timer.current = setTimeout(() => {
      router.replace(`${dashboardHref(section)}?${next}`, { scroll: false });
    }, 300);
  }

  const placeholder: Partial<Record<DashboardSection, string>> = {
    Appointments: "Search appointments",
    Customers: "Search by name, email, or phone",
    Services: "Search services",
    Team: "Search team members",
    "Time off": "Search time off",
    Notifications: "Search notifications",
  };

  return (
    <SearchField
      label={`Search ${section.toLowerCase()}`}
      placeholder={placeholder[section] ?? "Search…"}
      value={value}
      onChange={updateSearch}
      className="sm:max-w-[18rem]"
    />
  );
}

export function ListControls({
  data,
  section,
}: {
  data: WorkspaceDashboardData;
  section: DashboardSection;
}) {
  const page = data.pagination;
  if (!page || section !== "Appointments") return null;

  return <AppointmentFilters data={data} page={page} />;
}

function AppointmentFilters({
  data,
  page,
}: {
  data: WorkspaceDashboardData;
  page: NonNullable<WorkspaceDashboardData["pagination"]>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasStatus = Boolean(page.status);
  const hasDate = Boolean(page.from || page.to);
  const committedFilters = `${page.status}|${page.from}|${page.to}`;
  const [filterDraft, setFilterDraft] = useState({
    committed: committedFilters,
    includeStatus: hasStatus,
    includeDate: hasDate,
    status: page.status,
    from: page.from,
    to: page.to,
  });
  const draft =
    filterDraft.committed === committedFilters
      ? filterDraft
      : {
          committed: committedFilters,
          includeStatus: hasStatus,
          includeDate: hasDate,
          status: page.status,
          from: page.from,
          to: page.to,
        };
  const [open, setOpen] = useState(false);
  const [dateError, setDateError] = useState("");

  function replaceFilters(nextFilters: {
    status: string;
    from: string;
    to: string;
  }) {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    for (const key of ["status", "from", "to"] as const) {
      const value = nextFilters[key];
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.set("workspace", data.workspace.id);
    router.replace(`${dashboardHref("Appointments")}?${next}`, {
      scroll: false,
    });
  }

  function applyFilters() {
    if (draft.includeDate && draft.from && draft.to && draft.from > draft.to) {
      setDateError("Choose an end date on or after the start date.");

      return;
    }

    setDateError("");
    replaceFilters({
      status: draft.includeStatus ? draft.status : "",
      from: draft.includeDate ? draft.from : "",
      to: draft.includeDate ? draft.to : "",
    });
    setOpen(false);
  }

  function clearFilters() {
    setFilterDraft({
      committed: committedFilters,
      includeStatus: false,
      includeDate: false,
      status: "",
      from: "",
      to: "",
    });
    setDateError("");
    replaceFilters({ status: "", from: "", to: "" });
    setOpen(false);
  }

  function clearStatus() {
    setFilterDraft({ ...draft, includeStatus: false, status: "" });
    replaceFilters({ status: "", from: page.from, to: page.to });
  }

  function clearDate() {
    setFilterDraft({ ...draft, includeDate: false, from: "", to: "" });
    replaceFilters({ status: page.status, from: "", to: "" });
  }

  const hasFilters = hasStatus || hasDate;
  const dateLabel = [page.from, page.to].filter(Boolean).join(" – ");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger
          render={
            <Button variant="outline" size="sm" className="border-dashed" />
          }
        >
          <PlusIcon data-icon="inline-start" />
          Add filter
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Trigger
          onClick={() => setFilterDraft({ ...draft, includeDate: true })}
          render={
            <Button variant="outline" size="sm" className="border-dashed" />
          }
        >
          <CalendarDaysIcon data-icon="inline-start" />
          Filter by date
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            className="z-50 outline-none"
            align="start"
            side="bottom"
            sideOffset={6}
          >
            <PopoverPrimitive.Popup
              aria-label="Appointment filters"
              className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none"
            >
              <div className="max-h-[min(70vh,32rem)] overflow-y-auto">
                {draft.includeStatus ? (
                  <section className="border-b px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label
                        htmlFor="appointment-status-filter"
                        className="text-sm font-medium"
                      >
                        Status
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove status filter"
                        onClick={() =>
                          setFilterDraft({
                            ...draft,
                            includeStatus: false,
                            status: "",
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <NativeSelect
                      id="appointment-status-filter"
                      value={draft.status}
                      onChange={(event) =>
                        setFilterDraft({ ...draft, status: event.target.value })
                      }
                      className="w-full"
                    >
                      <NativeSelectOption value="">
                        All statuses
                      </NativeSelectOption>
                      <NativeSelectOption value="confirmed">
                        Confirmed
                      </NativeSelectOption>
                      <NativeSelectOption value="completed">
                        Completed
                      </NativeSelectOption>
                      <NativeSelectOption value="cancelled">
                        Cancelled
                      </NativeSelectOption>
                      <NativeSelectOption value="no_show">
                        No show
                      </NativeSelectOption>
                    </NativeSelect>
                  </section>
                ) : (
                  <Button
                    variant="ghost"
                    className="h-11 w-full justify-between rounded-none px-4"
                    onClick={() =>
                      setFilterDraft({ ...draft, includeStatus: true })
                    }
                  >
                    Status
                    <PlusIcon />
                  </Button>
                )}
                {draft.includeDate && (
                  <section className="border-b px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Date period</p>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove date filter"
                        onClick={() =>
                          setFilterDraft({
                            ...draft,
                            includeDate: false,
                            from: "",
                            to: "",
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        aria-label="Start date"
                        type="date"
                        value={draft.from}
                        onChange={(event) => {
                          setFilterDraft({
                            ...draft,
                            from: event.target.value,
                          });
                          setDateError("");
                        }}
                      />
                      <Input
                        aria-label="End date"
                        type="date"
                        value={draft.to}
                        onChange={(event) => {
                          setFilterDraft({ ...draft, to: event.target.value });
                          setDateError("");
                        }}
                      />
                    </div>
                    {dateError && (
                      <p className="mt-2 text-xs text-destructive" role="alert">
                        {dateError}
                      </p>
                    )}
                  </section>
                )}
              </div>
              <div className="flex items-center justify-between border-t p-3">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Reset
                </Button>
                <Button size="sm" onClick={applyFilters}>
                  Filter
                </Button>
              </div>
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {hasStatus && (
        <Button variant="outline" size="sm" onClick={clearStatus}>
          Status: {page.status.replace("_", " ")}
          <XIcon data-icon="inline-end" />
        </Button>
      )}
      {hasDate && (
        <Button variant="outline" size="sm" onClick={clearDate}>
          Date: {dateLabel}
          <XIcon data-icon="inline-end" />
        </Button>
      )}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear all
        </Button>
      )}
    </div>
  );
}

export function ListPagination({
  data,
  section,
}: {
  data: WorkspaceDashboardData;
  section: DashboardSection;
}) {
  const params = useSearchParams();
  const page = data.pagination;
  if (!page) return null;
  const path = dashboardHref(section);
  const first = new URLSearchParams(params);
  first.set("workspace", data.workspace.id);
  first.delete("cursor");
  const next = new URLSearchParams(first);
  next.set("cursor", page.nextCursor);
  return (
    <nav
      aria-label={`${section} pages`}
      className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
    >
      <span>
        {page.total} {page.total === 1 ? "record" : "records"}
      </span>
      <div className="flex items-center gap-4">
        {params.has("cursor") && (
          <Link href={`${path}?${first}`}>First page</Link>
        )}
        {page.nextCursor && <Link href={`${path}?${next}`}>Next page</Link>}
      </div>
    </nav>
  );
}
