export const text = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();

export const number = (data: FormData, key: string) =>
  Number(data.get(key) ?? 0);

export const boolOptions = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
];
