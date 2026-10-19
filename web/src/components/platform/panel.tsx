import type { ReactNode } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import {
  dashboardPanelBodyClassName,
  dashboardPanelHeaderClassName,
} from "./panel-styles";

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader
        className={`${dashboardPanelHeaderClassName} flex flex-col gap-3 border-b sm:flex-row sm:items-start sm:justify-between`}
      >
        <div className="min-w-0">
          <CardTitle className="text-balance">
            <h2>{title}</h2>
          </CardTitle>
          {description && (
            <CardDescription className="mt-1 text-pretty">
              {description}
            </CardDescription>
          )}
        </div>
        {action && (
          <CardAction className="flex shrink-0 flex-wrap items-center gap-2">
            {action}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className={dashboardPanelBodyClassName}>
        {children}
      </CardContent>
    </Card>
  );
}
