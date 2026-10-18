import { z } from "zod";
import { notFound } from "next/navigation";
import { CustomerBooking } from "@/components/workspace/booking-ui";
export const metadata = {
  title: "Manage your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({ params }: PageProps<"/booking/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <CustomerBooking id={id} />;
}
