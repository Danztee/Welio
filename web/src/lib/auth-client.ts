"use client";

import type { APIModel, CamelFields } from "./backend/contract";
import { createClient } from "./backend/generated/client";
import * as sdk from "./backend/generated/sdk.gen";
import { refreshSession } from "./auth/refresh";
import { apiUrl } from "./api-url.ts";
import { fromAPIContract } from "./api-contract";

type AuthError = { code: string; status: number; message: string };
type Result<T> = { data: T | null; error: AuthError | null };
export type AuthUser = APIModel<"User">;
export type AuthSession = APIModel<"Session">;
type Problem = {
  code?: string;
  detail?: string;
  status?: number;
  title?: string;
};

function browserClient() {
  return createClient({
    baseUrl: apiUrl("/").replace(/\/$/, ""),
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json, application/problem+json" },
    fetch: (request) => fetch(request, { signal: AbortSignal.timeout(10_000) }),
  });
}

type Request = { client: ReturnType<typeof browserClient> };
async function send<T>(
  operation: (
    options: Request,
  ) => Promise<{ data?: T; error?: Problem; response?: Response }>,
  refreshOnUnauthorized = false,
): Promise<Result<CamelFields<T>>> {
  try {
    const request = { client: browserClient() };
    let result = await operation(request);
    if (
      result.response?.status === 401 &&
      refreshOnUnauthorized &&
      (await refreshSession())
    ) {
      result = await operation(request);
    }
    if (!result.response) throw new Error("The API did not return a response.");
    if (!result.response.ok) {
      const problem = result.error;
      return {
        data: null,
        error: {
          code: problem?.code ?? "request_failed",
          status: problem?.status ?? result.response?.status,
          message: problem?.detail ?? problem?.title ?? "The request failed.",
        },
      };
    }
    return {
      data:
        result.data === undefined
          ? null
          : fromAPIContract<CamelFields<T>>(result.data),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: {
        code: "network_error",
        status: 0,
        message: "Could not reach the Welio API.",
      },
    };
  }
}

export const authClient = {
  signUp: {
    email(input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }) {
      return send((request) =>
        sdk.authRegister({
          ...request,
          body: {
            first_name: input.firstName,
            last_name: input.lastName,
            email: input.email,
            password: input.password,
          },
        }),
      );
    },
  },
  signIn: {
    email(input: { email: string; password: string }) {
      return send((request) => sdk.authLogin({ ...request, body: input }));
    },
  },
  signOut: () => send(sdk.authLogout),
  requestPasswordReset: (input: { email: string }) =>
    send((request) =>
      sdk.authPasswordResetRequest({ ...request, body: input }),
    ),
  resetPassword: (input: { newPassword: string; token: string }) =>
    send((request) =>
      sdk.authPasswordReset({
        ...request,
        body: { password: input.newPassword, token: input.token },
      }),
    ),
  sendVerificationEmail: (input: { email: string }) =>
    send((request) => sdk.authResendVerification({ ...request, body: input })),
  updateUser: (input: { firstName: string; lastName: string }) =>
    send(
      (request) =>
        sdk.meUpdate({
          ...request,
          body: { first_name: input.firstName, last_name: input.lastName },
        }),
      true,
    ),
  async getSession() {
    const [user, session] = await Promise.all([
      send(sdk.meGet, true),
      send(sdk.meSessionGet, true),
    ]);
    if (user.error) return { data: null, error: user.error };
    if (session.error) return { data: null, error: session.error };
    return { data: { user: user.data, session: session.data }, error: null };
  },
  listSessions: () => send(sdk.meSessionsList, true),
  revokeSession: (input: { id: string }) =>
    send((request) => sdk.meSessionRevoke({ ...request, path: input }), true),
  revokeOtherSessions: () => send(sdk.meSessionsRevokeOthers, true),
};
