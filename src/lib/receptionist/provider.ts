import "server-only";

import { BedrockModel } from "@strands-agents/sdk";
import { z } from "zod";
import { ReceptionistError } from "./contract";

export function aiConfigured() {
  return Boolean(
    process.env.AWS_REGION?.trim() && process.env.BEDROCK_MODEL_ID?.trim(),
  );
}
export function receptionistModel() {
  const region = process.env.AWS_REGION?.trim();
  const modelId = process.env.BEDROCK_MODEL_ID?.trim();
  if (!region || !modelId)
    throw new ReceptionistError(
      "The receptionist is temporarily unavailable. Please try again later or use the booking form.",
      503,
    );
  return new BedrockModel({
    region,
    modelId,
    apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() || undefined,
    maxTokens: 700,
    stream: false,
    requestTimeout: 30_000,
    clientConfig: { maxAttempts: 1 },
  });
}
export function dailyModelCallLimit() {
  const value = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .safeParse(process.env.AI_DAILY_CALL_LIMIT ?? "200");
  if (!value.success)
    throw new ReceptionistError(
      "The receptionist is temporarily unavailable. Please try again later or use the booking form.",
      503,
    );
  return value.data;
}

export function modelFailure(error: unknown): ReceptionistError {
  if (error instanceof ReceptionistError) return error;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const details = z
      .object({
        status: z.number().optional(),
        name: z.string().optional(),
        $metadata: z
          .object({ httpStatusCode: z.number().optional() })
          .optional(),
        cause: z.unknown().optional(),
      })
      .safeParse(current);
    if (!details.success) break;
    const { name, cause } = details.data;
    const status =
      details.data.status ?? details.data.$metadata?.httpStatusCode;
    if (
      name === "ThrottlingException" ||
      name === "ModelThrottledError" ||
      status === 429
    )
      return new ReceptionistError(
        "The receptionist is busy. Please try again later or use the booking form.",
        503,
      );
    if (
      status === 401 ||
      name === "CredentialsProviderError" ||
      name === "UnrecognizedClientException"
    )
      return new ReceptionistError(
        "The receptionist is temporarily unavailable. Please try again later or use the booking form.",
        503,
      );
    if (
      status === 403 ||
      status === 404 ||
      name === "AccessDeniedException" ||
      name === "ResourceNotFoundException"
    )
      return new ReceptionistError(
        "The receptionist is temporarily unavailable. Please try again later or use the booking form.",
        503,
      );
    current = cause;
  }
  return new ReceptionistError(
    "The receptionist could not respond. Please retry or use the booking form.",
    503,
  );
}
