import { sendZeptoMail, zeptoMailConfig } from "./zeptomail";
import type { AuthMail } from "@/lib/auth/factory";

export function emailConfiguration() {
  return zeptoMailConfig({
    token: process.env.ZEPTOMAIL_SEND_MAIL_TOKEN,
    from: process.env.EMAIL_FROM,
  });
}

export async function sendMail(message: AuthMail) {
  await sendZeptoMail(message, emailConfiguration());
}
