import { Brand } from "@/components/brand";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-card text-foreground">
      <header className="flex justify-center px-6 py-8 sm:py-10">
        <Brand href="/sign-in" />
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-md px-6 pt-12 pb-16 sm:pt-20"
      >
        {children}
      </main>
    </div>
  );
}
