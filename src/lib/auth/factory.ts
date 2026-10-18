import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { nextCookies } from "better-auth/next-js";
import { accountNamesSchema } from "./validation";
import type { Database } from "@/db/connection";
import {
  users,
  sessions,
  accounts,
  verifications,
  rateLimits,
} from "@/db/schema";
export type AuthMail = { to: string; subject: string; text: string };
export function createAuth(
  db: Database,
  options: {
    secret: string;
    baseURL: string;
    origins: string[];
    sendMail: (message: AuthMail) => Promise<void>;
    ipAddressHeaders?: string[];
  },
) {
  return betterAuth({
    appName: "Welio",
    user: {
      additionalFields: {
        firstName: {
          type: "string",
          required: true,
          validator: { input: accountNamesSchema.shape.firstName },
        },
        lastName: {
          type: "string",
          required: true,
          validator: { input: accountNamesSchema.shape.lastName },
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const parsed = accountNamesSchema.safeParse(user);
            if (!parsed.success)
              throw new APIError("BAD_REQUEST", {
                message: "Enter a first and last name of 1–50 characters each.",
              });
            const { firstName, lastName } = parsed.data;
            return {
              data: {
                ...user,
                firstName,
                lastName,
                name: `${firstName} ${lastName}`,
              },
            };
          },
        },
        update: {
          before: async (data) => {
            if (
              data.name !== undefined ||
              "firstName" in data ||
              "lastName" in data
            ) {
              const parsed = accountNamesSchema.safeParse(data);
              if (!parsed.success)
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Enter a first and last name of 1–50 characters each.",
                });
              const { firstName, lastName } = parsed.data;
              return {
                data: {
                  ...data,
                  firstName,
                  lastName,
                  name: `${firstName} ${lastName}`,
                },
              };
            }
            return { data };
          },
        },
      },
    },
    onAPIError: { errorURL: "/verify-email" },
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.origins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        rateLimit: rateLimits,
      },
      transaction: true,
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "welio",
      ipAddress: { ipAddressHeaders: options.ipAddressHeaders ?? [] },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ user, url }) =>
        options.sendMail({
          to: user.email,
          subject: "Reset your Welio password",
          text: `Reset your password using this link (expires in 30 minutes):\n\n${url}\n\nIf you didn’t request this, ignore this email.`,
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        options.sendMail({
          to: user.email,
          subject: "Verify your Welio email",
          text: `Confirm your email to start using Welio (expires in 1 hour):\n\n${url}\n\nIf you didn’t request this account, ignore this email.`,
        }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    plugins: [nextCookies()],
  });
}
