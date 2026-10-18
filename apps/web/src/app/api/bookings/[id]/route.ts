import { z } from "zod";
import { getDatabase } from "@welio/db";
import {
  getBooking,
  changeBooking,
  changeAvailability,
} from "@welio/db/bookings";
import { changeInput, dateInput } from "@welio/domain/bookings/contract";
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
      changeInput.parse(body),
      appOrigin(),
    );
    dispatchEmail();

    return bookingResponse(result);
  } catch (e) {
    return bookingFailure(e);
  }
}
