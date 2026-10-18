export class BookingError extends Error {
  constructor(
    message: string,
    public code:
      | "conflict"
      | "forbidden"
      | "invalid"
      | "not_found"
      | "unavailable" = "conflict",
  ) {
    super(message);
  }
}
