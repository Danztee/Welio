import type { ReactNode } from "react";

export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          {action}
        </div>
      )}
    </div>
  );
}
