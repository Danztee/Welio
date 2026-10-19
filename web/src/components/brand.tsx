import Link from "next/link";

export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label={href === "/dashboard" ? "Welio dashboard" : "Welio"}
      className="inline-flex w-fit items-center gap-2.5 rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 30 30"
        className="size-8 text-primary"
        fill="none"
      >
        <path
          d="M3 8.5 8.6 22a2.1 2.1 0 0 0 3.9 0L15 15.6 17.5 22a2.1 2.1 0 0 0 3.9 0L27 8.5"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-2xl font-semibold tracking-[-0.06em]">welio</span>
    </Link>
  );
}
