export const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
    value / 100,
  );

export const formatWhen = (value: string | Date, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export const formatBookingDate = (value: string | Date, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
