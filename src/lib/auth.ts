import "server-only";
import { after } from "next/server";
import { getDatabase } from "@/db";
import { createAuth } from "./auth/factory";
import { sendMail } from "./auth/email";
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  if (auth) return auth;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw Error(
      "Configure BETTER_AUTH_SECRET with at least 32 random characters.",
    );
  const baseURL =
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";
  if (!URL.canParse(baseURL))
    throw Error("Configure BETTER_AUTH_URL with a valid absolute URL.");
  const origin = new URL(baseURL).origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
    throw Error("Production authentication requires HTTPS.");
  auth = createAuth(getDatabase(), {
    secret,
    baseURL: origin,
    origins: [origin],
    ipAddressHeaders: process.env.AUTH_TRUSTED_IP_HEADER
      ? [process.env.AUTH_TRUSTED_IP_HEADER]
      : [],
    sendMail: async (message) => {
      after(async () => {
        try {
          await sendMail(message);
        } catch {
          console.error(
            JSON.stringify({ event: "auth_email_delivery_failed" }),
          );
        }
      });
    },
  });
  return auth;
}
