import type { ReceptionistError } from "@welio/domain/receptionist/contract";

export function receptionistStatus(error: ReceptionistError) {
  switch (error.code) {
    case "conflict":
      return 409;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    case "unprocessable":
      return 422;
  }
}
