import { z } from "zod";
import { getDatabase } from "@welio/db";
import { getAvailability } from "@welio/db/bookings";
import { slotInput } from "@welio/domain/bookings/contract";
import {
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/book/[slug]/availability">,
) {
  try {
    await rateLimit(request, "availability", 120, 60);
    const slug = z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .parse((await params).slug);
    const q = new URL(request.url).searchParams;

    return bookingResponse(
      await getAvailability(
        getDatabase(),
        { slug },
        {
          ...slotInput.parse({
            serviceId: q.get("serviceId"),
            date: q.get("date"),
            ...(q.get("staffId") ? { staffId: q.get("staffId") } : {}),
          }),
        },
      ),
    );
  } catch (e) {
    return bookingFailure(e);
  }
}
