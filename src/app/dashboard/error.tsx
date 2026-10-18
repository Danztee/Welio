"use client";

import Link from "next/link";
import { AlertCircleIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex h-16 items-center border-b bg-card px-5 sm:px-8">
        <Brand href="/sign-in" />
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <Card className="w-full max-w-lg gap-0 p-6 shadow-sm sm:p-8">
          <CardHeader className="px-0 pt-0">
            <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-danger-surface text-danger-foreground">
              <AlertCircleIcon aria-hidden="true" className="size-5" />
            </span>
            <CardTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
              <h1>Your workspace didn’t load</h1>
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              Something went wrong while opening your workspace. Try again, or
              sign in again if the problem continues.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-6 flex flex-col gap-3 px-0 pb-0 sm:flex-row">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" render={<Link href="/sign-in" />}>
              Return to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
