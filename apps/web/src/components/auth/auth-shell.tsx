import { Brand } from "@/components/brand";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-svh bg-card text-foreground lg:grid-cols-[minmax(480px,39%)_1fr]">
      <header className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-6 py-7 sm:px-8">
        <Brand />
      </header>
      <main
        id="main"
        className="flex min-w-0 flex-col items-center justify-center px-6 pt-36 pb-16 sm:px-10"
      >
        <div className="w-full max-w-96">{children}</div>
      </main>
      <aside
        aria-label="About Welio"
        className="hidden items-center justify-center border-l bg-card px-16 lg:flex"
      >
        <div className="flex w-full max-w-lg flex-col gap-6">
          <h2 className="text-[2rem] leading-[1.3] font-normal tracking-tight">
            Your AI Front Desk,
            <br />
            Always On.
          </h2>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            Appointments and customer conversations, in one place.
          </p>
        </div>
      </aside>
    </div>
  );
}
