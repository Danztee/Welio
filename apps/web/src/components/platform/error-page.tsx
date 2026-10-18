import type { ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@welio/ui/components/alert";

export function ErrorPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 p-8 py-24">
      <Alert>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      {children}
    </div>
  );
}
