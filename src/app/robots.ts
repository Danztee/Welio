import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/book/", "/booking/"],
      disallow: [
        "/dashboard/",
        "/api/",
        "/sign-in",
        "/sign-up",
        "/onboarding",
        "/accept-invite",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/invoice/",
        "/checkout/",
      ],
    },
    host: env.APP_URL,
  };
}
