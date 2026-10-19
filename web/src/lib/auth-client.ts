"use client";

import { apiUrl } from "./api-url.ts";
import { fromAPIContract, toAPIContract } from "./api-contract";

type AuthError = { code: string; status: number; message: string };
type Result<T> = { data: T | null; error: AuthError | null };

export type AuthUser = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: string;
};

export type AuthSession = {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

type AuthPayload = {
  user?: AuthUser;
  verificationRequired?: boolean;
  expiresIn?: number;
};

type Problem = {
  code?: string;
  detail?: string;
  status?: number;
  title?: string;
};

const base = "/v1";

async function send<T>(
  path: string,
  init: RequestInit = {},
  options: { refreshOnUnauthorized?: boolean } = {},
): Promise<Result<T>> {
  const request = () =>
    fetch(apiUrl(`${base}${path}`), {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json, application/problem+json",
        ...init.headers,
      },
    });

  try {
    let response = await request();
    if (response.status === 401 && options.refreshOnUnauthorized) {
      const refreshed = await fetch(apiUrl(`${base}/auth/refresh`), {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json, application/problem+json" },
      });
      if (refreshed.ok) response = await request();
    }

    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as Problem;

      return {
        data: null,
        error: {
          code: problem.code ?? "request_failed",
          status: problem.status ?? response.status,
          message: problem.detail ?? problem.title ?? "The request failed.",
        },
      };
    }

    const data =
      response.status === 204
        ? null
        : fromAPIContract<T>(await response.json());

    return { data, error: null };
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

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(toAPIContract(body)) }),
  };
}

export const authClient = {
  signUp: {
    email(input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }) {
      return send<AuthPayload>("/auth/register", json("POST", input));
    },
  },
  signIn: {
    email(input: { email: string; password: string }) {
      return send<AuthPayload>("/auth/login", json("POST", input));
    },
  },
  signOut() {
    return send<null>("/auth/logout", json("POST"));
  },
  requestPasswordReset(input: { email: string }) {
    return send<null>("/auth/password/reset/request", json("POST", input));
  },
  resetPassword(input: { newPassword: string; token: string }) {
    return send<null>(
      "/auth/password/reset",
      json("POST", { password: input.newPassword, token: input.token }),
    );
  },
  sendVerificationEmail(input: { email: string }) {
    return send<null>("/auth/verify-email/resend", json("POST", input));
  },
  updateUser(input: { firstName: string; lastName: string }) {
    return send<AuthUser>("/me", json("PATCH", input), {
      refreshOnUnauthorized: true,
    });
  },
  async getSession() {
    const [user, session] = await Promise.all([
      send<AuthUser>("/me", {}, { refreshOnUnauthorized: true }),
      send<AuthSession>("/me/session", {}, { refreshOnUnauthorized: true }),
    ]);
    if (user.error) return { data: null, error: user.error };

    if (session.error) return { data: null, error: session.error };

    return { data: { user: user.data, session: session.data }, error: null };
  },
  listSessions() {
    return send<AuthSession[]>(
      "/me/sessions",
      {},
      {
        refreshOnUnauthorized: true,
      },
    );
  },
  revokeSession(input: { id: string }) {
    return send<null>(
      `/me/sessions/${encodeURIComponent(input.id)}`,
      {
        method: "DELETE",
      },
      { refreshOnUnauthorized: true },
    );
  },
  revokeOtherSessions() {
    return send<null>("/me/sessions/revoke-others", json("POST"), {
      refreshOnUnauthorized: true,
    });
  },
};
