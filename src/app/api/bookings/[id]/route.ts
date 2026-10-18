import { z } from "zod";
import { getDatabase } from "@/db";
import {
  getBooking,
  changeBooking,
  changeAvailability,
} from "@/lib/bookings/repository";
import { dateInput } from "@/lib/bookings/contract";
import {
  appOrigin,
  requireOrigin,
  readBody,
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";
import { dispatchEmail } from "@/lib/bookings/dispatch";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/bookings/[id]">,
) {
  try {
    requireOrigin(request);
    await rateLimit(request, "manage", 60, 60);
    const id = z.uuid().parse((await params).id);
    const body = z
      .looseObject({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        action: z.enum(["view", "availability", "reschedule", "cancel"]),
      })
      .parse(await readBody(request));
    const actor = { token: body.token };
    if (body.action === "view")
      return bookingResponse(await getBooking(getDatabase(), id, actor));
    if (body.action === "availability")
      return bookingResponse(
        await changeAvailability(
          getDatabase(),
          id,
          actor,
          dateInput.parse(body.date),
        ),
      );
    const result = await changeBooking(
      getDatabase(),
      id,
      actor,
      body,
      appOrigin(),
    );
    dispatchEmail();
    return bookingResponse(result);
  } catch (e) {
    return bookingFailure(e);
  }
}
