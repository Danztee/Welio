"use client";

import { useEffect, useRef, useTransition } from "react";
import { SearchIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { dashboardHref, type DashboardSection } from "@/lib/dashboard-routes";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";

export function ListControls({
  data,
  section,
}: {
  data: WorkspaceDashboardData;
  section: DashboardSection;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  const page = data.pagination;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!form.current || !page) return;
    for (const name of ["search", "from", "to", "status"] as const) {
      const input = form.current.elements.namedItem(name);
      if (
        (input instanceof HTMLInputElement ||
          input instanceof HTMLSelectElement) &&
        input !== document.activeElement
      )
        input.value = page[name];
    }
  }, [page]);
  if (!page) return null;

  function apply(delay = 0) {
    if (timer.current) clearTimeout(timer.current);
    if (!form.current) return;
    const values = new FormData(form.current);
    const endDate = form.current.elements.namedItem("to");
    if (endDate instanceof HTMLInputElement) {
      const from = String(values.get("from") ?? "");
      const to = String(values.get("to") ?? "");
      endDate.setCustomValidity(
        from && to && from > to
          ? "Choose an end date on or after the start date."
          : "",
      );
      if (!endDate.reportValidity()) return;
    }
    const next = new URLSearchParams(params);
    next.delete("cursor");
    for (const key of ["search", "from", "to", "status"]) {
      const value = String(values.get(key) ?? "").trim();
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.set("workspace", data.workspace.id);
    timer.current = setTimeout(() => {
      startTransition(() =>
        router.replace(`${dashboardHref(section)}?${next}`, { scroll: false }),
      );
    }, delay);
  }

  return (
    <form
      ref={form}
      aria-label={`${section} filters`}
      aria-busy={pending}
      className="grid w-full grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      onChange={(event) =>
        apply(
          event.target instanceof HTMLInputElement &&
            event.target.type === "search"
            ? 300
            : 0,
        )
      }
    >
      <InputGroup className="col-span-2 w-full sm:max-w-xs">
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          name="search"
          autoComplete="off"
          aria-label={`Search all ${section.toLowerCase()}`}
          placeholder="Search…"
          defaultValue={page.search}
          maxLength={200}
        />
      </InputGroup>
      {section === "Appointments" && (
        <>
          <label className="col-span-2 flex min-w-0 flex-col gap-1 text-sm sm:col-span-1">
            From
            <Input name="from" type="date" defaultValue={page.from} />
          </label>
          <label className="col-span-2 flex min-w-0 flex-col gap-1 text-sm sm:col-span-1">
            To
            <Input name="to" type="date" defaultValue={page.to} />
          </label>
          <NativeSelect
            name="status"
            aria-label="Appointment status"
            defaultValue={page.status}
          >
            <NativeSelectOption value="">All statuses</NativeSelectOption>
            <NativeSelectOption value="confirmed">Confirmed</NativeSelectOption>
            <NativeSelectOption value="completed">Completed</NativeSelectOption>
            <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
            <NativeSelectOption value="no_show">No show</NativeSelectOption>
          </NativeSelect>
        </>
      )}
      <span className="sr-only" role="status">
        {pending ? "Updating results…" : ""}
      </span>
    </form>
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
