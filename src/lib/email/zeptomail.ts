import { z } from "zod";
import type { AuthMail } from "@/lib/auth/factory";
export const ZEPTOMAIL_API_URL = "https://api.zeptomail.com/v1.1/email";
export function zeptoMailConfig(input: { token?: string; from?: string }) {
  const token = input.token?.trim().replace(/^Zoho-enczapikey\s+/i, "");
  if (!token || /[\r\n]/.test(token))
    throw Error(
      "Configure ZEPTOMAIL_SEND_MAIL_TOKEN with your Send Mail token.",
    );
  const raw = input.from?.trim() ?? "";
  const match = raw.match(/^([^<>\r\n]+)\s*<([^<>\r\n]+)>$/);
  const address = (match?.[2] ?? raw).trim();
  if (!z.email().safeParse(address).success)
    throw Error("Configure EMAIL_FROM with a verified sender address.");
  return {
    token,
    from: { address, ...(match ? { name: match[1].trim() } : {}) },
  };
}
export async function sendZeptoMail(
  message: AuthMail,
  config: ReturnType<typeof zeptoMailConfig>,
  request: typeof fetch = fetch,
) {
  try {
    const response = await request(ZEPTOMAIL_API_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Zoho-enczapikey ${config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [{ email_address: { address: message.to } }],
        subject: message.subject,
        textbody: message.text,
        track_clicks: false,
        track_opens: false,
      }),
    });
    if (!response.ok) throw Error("Provider rejected email.");
  } catch {
    throw Error(
      "ZeptoMail could not accept this email. Check the sender, token, data center, and provider status.",
    );
  }
}
