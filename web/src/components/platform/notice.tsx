import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Notice({
  children,
  error = false,
  tone = "neutral",
}: {
  children: ReactNode;
  error?: boolean;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <Alert
      role={error ? "alert" : "status"}
      variant={
        error
          ? "destructive"
          : tone === "success"
            ? "success"
            : tone === "warning"
              ? "warning"
              : "default"
      }
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
