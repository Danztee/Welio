import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
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

export default nextConfig;
