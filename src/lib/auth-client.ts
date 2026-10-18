"use client";
import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { createAuth } from "./auth/factory";
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<ReturnType<typeof createAuth>>()],
});
