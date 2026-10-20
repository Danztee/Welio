type Query = Record<string, string | string[] | undefined>;
type BookingCatalog = {
  today: string;
  maxDate: string;
  services: { id: string; staffIds: string[] }[];
};

export function bookingSelectionFromLink(
  catalog: BookingCatalog,
  query: Query,
) {
  const serviceId = typeof query.service === "string" ? query.service : "";
  const date = typeof query.date === "string" ? query.date : "";
  const staffId = typeof query.staff === "string" ? query.staff : "";
  const service = catalog.services.find((item) => item.id === serviceId);
  if (
    !service ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < catalog.today ||
    date > catalog.maxDate
  )
    return undefined;

  return {
    serviceId: service.id,
    date,
    staffId: service.staffIds.includes(staffId) ? staffId : "",
  };
}
