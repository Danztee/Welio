import { Badge } from "@/components/ui/badge";

export function Status({ value }: { value: string }) {
  const normalized = value.trim().replaceAll("_", " ").toLowerCase();
  const tone = [
    "completed",
    "confirmed",
    "paid",
    "sent",
    "active",
    "delivered",
    "published",
    "enabled",
    "ready",
  ].includes(normalized)
    ? "success"
    : [
          "pending",
          "draft",
          "unpaid",
          "proposed",
          "invited",
          "paused",
          "unpublished",
          "sending",
        ].includes(normalized)
      ? "warning"
      : [
            "failed",
            "cancelled",
            "declined",
            "overdue",
            "inactive",
            "revoked",
            "no show",
          ].includes(normalized)
        ? "danger"
        : "neutral";

  return (
    <Badge variant="outline" tone={tone}>
      {value}
    </Badge>
  );
}
