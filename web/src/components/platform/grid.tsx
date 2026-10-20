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
import { cn } from "@/lib/utils";

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
  const emptyTitle =
    query && !externalSearch
      ? "No matching records"
      : (empty ?? "No records found");
  const emptyMessage =
    query && !externalSearch
      ? "Try a different search."
      : (emptyDescription ?? "There’s nothing to show here yet.");

  const content = (
    <>
      {!compact && (
        <GridToolbar
          externalSearch={externalSearch}
          search={search}
          onSearch={setSearch}
          toolbar={toolbar}
        />
      )}
      {visibleRows.length ? (
        <RecordsTable rows={visibleRows} columns={columns} compact={compact} />
      ) : (
        <Blank title={emptyTitle} description={emptyMessage} />
      )}
      {!compact && <GridFooter count={visibleRows.length} footer={footer} />}
    </>
  );

  return compact ? (
    <Card className="min-w-0 gap-0 py-0">{content}</Card>
  ) : (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      {content}
    </div>
  );
}

function GridToolbar({
  externalSearch,
  search,
  onSearch,
  toolbar,
}: {
  externalSearch: boolean;
  search: string;
  onSearch: (value: string) => void;
  toolbar?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 sm:px-6">
      {!externalSearch && (
        <SearchField
          label="Search records"
          value={search}
          onChange={onSearch}
        />
      )}
      {toolbar}
    </div>
  );
}

function RecordsTable<T>({
  rows,
  columns,
  compact,
}: {
  rows: T[];
  columns: { label: string; cell: (row: T) => ReactNode }[];
  compact: boolean;
}) {
  return (
    <Table>
      <TableHeader className={compact ? "bg-muted/35" : undefined}>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.label || "actions"}
              className={
                isActionColumn(column)
                  ? "w-px text-right first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                  : "text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
              }
            >
              {column.label || <span className="sr-only">Actions</span>}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell
                key={column.label || "actions"}
                className={
                  isActionColumn(column)
                    ? "w-px py-4 text-right first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                    : "py-4 text-sm tabular-nums first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6"
                }
              >
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function isActionColumn(column: { label: string }) {
  return column.label === "Actions" || !column.label;
}

function rowKey<T>(row: T) {
  return typeof row === "object" && row !== null && "id" in row
    ? String(row.id)
    : JSON.stringify(row);
}

function GridFooter({ count, footer }: { count: number; footer?: ReactNode }) {
  return (
    <div className="border-t px-4 py-3 sm:px-6">
      {footer ?? (
        <p className="text-xs tabular-nums text-muted-foreground" role="status">
          {count} {count === 1 ? "record" : "records"}
        </p>
      )}
    </div>
  );
}
