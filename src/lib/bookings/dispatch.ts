import "server-only";
import { after } from "next/server";
import { getDatabase } from "@/db";
import { sendMail, emailConfiguration } from "@/lib/auth/email";
import { deliverQueued } from "./outbox";
export function dispatchEmail(workspaceId?: string) {
  after(async () => {
    try {
      emailConfiguration();
      await deliverQueued(getDatabase(), sendMail, workspaceId, 3);
    } catch {
      console.error(JSON.stringify({ event: "booking_email_dispatch_failed" }));
    }
  });
}
