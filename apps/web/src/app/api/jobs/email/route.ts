import { timingSafeEqual } from "node:crypto";
import { getDatabase } from "@welio/db";
import { sendMail, emailConfiguration } from "@/lib/auth/email";
import { deliverQueued } from "@welio/db/bookings/outbox";
import { enqueueDueReminders } from "@welio/db/bookings/reminders";

export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.EMAIL_JOB_SECRET;
  const provided = request.headers.get("authorization") ?? "";
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(provided) !== Buffer.byteLength(`Bearer ${secret}`) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(`Bearer ${secret}`))
  )
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  try {
    emailConfiguration();
    const reminders = await enqueueDueReminders(getDatabase(), new Date(), 20);
    const delivery = await deliverQueued(getDatabase(), sendMail, undefined, 5);

    return Response.json(
      { ...delivery, remindersQueued: reminders.queued },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Email queue unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
