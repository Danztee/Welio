export function safeReturnPath(value: string | null) {
  return value &&
    (/^\/accept-invite\?token=[A-Za-z0-9_-]{40,100}$/.test(value) ||
      /^\/dashboard(?:\/(?:appointments|customers|receptionist|notifications|services|team|members|settings))?(?:\?workspace=[a-f0-9-]{36})?$/.test(
        value,
      ))
    ? value
    : "/dashboard";
}
