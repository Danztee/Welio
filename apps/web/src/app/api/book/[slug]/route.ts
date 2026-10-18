import { z } from "zod";
import { getDatabase } from "@welio/db";
import { getCatalog, createBooking } from "@welio/db/bookings";
import {
  appOrigin,
  requireOrigin,
  readBody,
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";
import { dispatchEmail } from "@/lib/bookings/dispatch";
import { bookingInput } from "@welio/domain/bookings/contract";

export const maxDuration = 60;

export const runtime = "nodejs";

const slugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/book/[slug]">,
) {
  try {
    await rateLimit(request, "catalog", 120, 60);
    const slug = slugSchema.parse((await params).slug);

    return bookingResponse(await getCatalog(getDatabase(), { slug }));
  } catch (e) {
    return bookingFailure(e);
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/book/[slug]">,
) {
  try {
    requireOrigin(request);
    await rateLimit(request, "create", 8, 3600);
    const slug = slugSchema.parse((await params).slug);
    const result = await createBooking(
      getDatabase(),
      { slug },
      bookingInput.parse(await readBody(request)),
      appOrigin(),
    );
    dispatchEmail();

    return bookingResponse(result, 201);
  } catch (e) {
    return bookingFailure(e);
  }
}
