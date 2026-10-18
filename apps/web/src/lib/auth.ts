import "server-only";
import { after } from "next/server";
import { getDatabase } from "@welio/db";
import { createAuth } from "./auth/factory";
import { sendMail } from "./auth/email";
import { appOrigin, appOrigins } from "./app-origin";

let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  if (auth) return auth;

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw Error(
      "Configure BETTER_AUTH_SECRET with at least 32 random characters.",
    );

  const origin = appOrigin();
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
    throw Error("Production authentication requires HTTPS.");

  auth = createAuth(getDatabase(), {
    secret,
    baseURL: origin,
    origins: appOrigins(),
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
