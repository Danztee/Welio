import { z } from "zod";
import { getDatabase } from "@/db";
import { currentUser } from "@/lib/auth/session";
import {
  getAvailability,
  getCatalog,
  changeAvailability,
} from "@/lib/bookings/repository";
import { dateInput } from "@/lib/bookings/contract";
import {
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/workspaces/[id]/availability">,
) {
  try {
    const user = await currentUser();
    if (!user?.emailVerified)
      return bookingResponse({ error: "Sign in to continue." }, 401);
    await rateLimit(request, "owner-availability", 120, 60);
    const workspaceId = z.uuid().parse((await params).id);
    const q = new URL(request.url).searchParams;
    if (q.get("catalog") === "true")
      return bookingResponse(
        await getCatalog(getDatabase(), { workspaceId, userId: user.id }),
      );
    if (q.get("appointmentId")) {
      const appointmentId = z.uuid().parse(q.get("appointmentId"));
      const booking = await import("@/lib/bookings/repository").then((r) =>
        r.getBooking(getDatabase(), appointmentId, { userId: user.id }),
      );
      await getCatalog(getDatabase(), {
        workspaceId,
        userId: user.id,
      });
      if (booking.workspaceId !== workspaceId)
        return bookingResponse({ error: "Booking unavailable." }, 404);
      return bookingResponse(
        await changeAvailability(
          getDatabase(),
          appointmentId,
          { userId: user.id },
          dateInput.parse(q.get("date")),
        ),
      );
    }
    return bookingResponse(
      await getAvailability(
        getDatabase(),
        { workspaceId, userId: user.id },
        {
          serviceId: q.get("serviceId"),
          date: q.get("date"),
          ...(q.get("staffId") ? { staffId: q.get("staffId") } : {}),
        },
      ),
    );
  } catch (e) {
    return bookingFailure(e);
  }
}
