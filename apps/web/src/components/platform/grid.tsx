import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@welio/ui/components/table";
import { Card } from "@welio/ui/components/card";
import { Blank } from "./blank";

export function Grid<T>({
  rows,
  columns,
  empty,
  emptyDescription,
  toolbar,
}: {
  rows: T[];
  columns: { label: string; cell: (row: T) => ReactNode }[];
  empty?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          {toolbar}
        </div>
      )}
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead
                  key={c.label || "actions"}
                  className={
                    c.label === "Actions" || !c.label
                      ? "w-px text-right"
                      : undefined
                  }
                >
                  {c.label || <span className="sr-only">Actions</span>}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
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
                        ? "w-px py-4 text-right"
                        : "py-4"
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
          title={empty ?? "No records found"}
          description={emptyDescription ?? "There’s nothing to show here yet."}
        />
      )}
    </Card>
  );
}
