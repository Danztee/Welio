import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app"],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
  // Account links contain one-time tokens; never log their query strings.
  logging: {
    incomingRequests: {
      ignore: [
        /\/api\/auth/,
        /\/session\/renew/,
        /\/accept-invite/,
        /\/reset-password/,
        /\/verify-email/,
      ],
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default function config(phase: string): NextConfig {
  return {
    ...nextConfig,
    distDir:
      process.env.WELIO_E2E === "1"
        ? ".next-e2e"
        : phase === PHASE_DEVELOPMENT_SERVER
          ? ".next"
          : ".next-build",
  };
}
