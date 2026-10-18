"use client";
import { Brand } from "@/components/brand";

export function BookingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-card">
      <header className="border-b bg-card px-6 py-5">
        <Brand />
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10">
        {children}
        <footer className="border-t pt-5 text-xs text-muted-foreground">
          Powered by Welio
        </footer>
      </main>
    </div>
  );
}
