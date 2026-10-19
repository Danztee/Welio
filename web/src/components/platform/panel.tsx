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
      <CardHeader className={`${dashboardPanelHeaderClassName} border-b`}>
        <div>
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          {description && (
            <CardDescription className="mt-1">{description}</CardDescription>
          )}
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={dashboardPanelBodyClassName}>
        {children}
      </CardContent>
    </Card>
  );
}
