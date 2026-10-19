/** Accept only local product destinations when restoring an account session. */
export function safeReturnPath(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/dashboard";
  const target = new URL(value, "https://welio.invalid");
  if (target.origin !== "https://welio.invalid") return "/dashboard";
  if (target.pathname === "/accept-invite") {
    return /^[A-Za-z0-9_-]{40,100}$/.test(
      target.searchParams.get("token") ?? "",
    ) && [...target.searchParams.keys()].every((key) => key === "token")
      ? target.pathname + target.search
      : "/dashboard";
  }
  if (
    !/^\/(?:onboarding|dashboard(?:\/(?:appointments|customers|receptionist|notifications|services|team|members|settings|time-off))?)$/.test(
      target.pathname,
    )
  )
    return "/dashboard";
  const allowed = new Set([
    "workspace",
    "tab",
    "cursor",
    "search",
    "from",
    "to",
    "new",
  ]);
  if ([...target.searchParams.keys()].some((key) => !allowed.has(key)))
    return "/dashboard";
  if (
    (target.searchParams.get("workspace") ?? "").length > 36 ||
    (target.searchParams.get("cursor") ?? "").length > 200 ||
    (target.searchParams.get("search") ?? "").length > 200
  )
    return "/dashboard";
  return target.pathname + target.search;
}
