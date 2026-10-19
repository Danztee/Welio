"use client";

import { useState, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Blank } from "./blank";
import { SearchField } from "./search-field";

export function Grid<T>({
  rows,
  columns,
  empty,
  emptyDescription,
  toolbar,
  footer,
  externalSearch = false,
  compact = false,
  searchText = (row) => JSON.stringify(row),
}: {
  rows: T[];
  columns: { label: string; cell: (row: T) => ReactNode }[];
  empty?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  externalSearch?: boolean;
  compact?: boolean;
  searchText?: (row: T) => string;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const visibleRows =
    externalSearch || compact || !query
      ? rows
      : rows.filter((row) =>
          searchText(row).toLocaleLowerCase().includes(query),
        );

  return (
    <Card className="min-w-0 gap-0 py-0">
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 border-b p-4 sm:px-6">
          {!externalSearch && (
            <SearchField
              label="Search records"
              value={search}
              onChange={setSearch}
            />
          )}
          {toolbar}
        </div>
      )}
      {visibleRows.length ? (
        <Table>
          <TableHeader className="bg-muted/35">
            <TableRow>
              {columns.map((c) => (
                <TableHead
                  key={c.label || "actions"}
                  className={
                    c.label === "Actions" || !c.label
                      ? "w-px text-right first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                      : "text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                  }
                >
                  {c.label || <span className="sr-only">Actions</span>}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow
                key={
                  typeof row === "object" && row !== null && "id" in row
                    ? String(row.id)
                    : JSON.stringify(row)
                }
              >
                {columns.map((c) => (
                  <TableCell
                    key={c.label || "actions"}
                    className={
                      c.label === "Actions" || !c.label
                        ? "w-px py-4 text-right first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                        : "py-4 text-sm tabular-nums first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                    }
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Blank
          title={
            query && !externalSearch
              ? "No matching records"
              : (empty ?? "No records found")
          }
          description={
            query && !externalSearch
              ? "Try a different search."
              : (emptyDescription ?? "There’s nothing to show here yet.")
          }
        />
      )}
      {!compact && (
        <div className="border-t px-4 py-3 sm:px-6">
          {footer ?? (
            <p
              className="text-xs tabular-nums text-muted-foreground"
              role="status"
            >
              {visibleRows.length}{" "}
              {visibleRows.length === 1 ? "record" : "records"}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
