# Workspace table search and notification filters — retrospective design

This describes the implementation in `85c87ba`, written after the commit.

## Local table search

`WorkspaceTables` passes all loaded service and team rows to the shared `Grid`
and supplies `searchText` for each row. The text combines values users see in
the table, plus related staff or access details. `BookingNotifications` also
supplies `searchText` for its loaded rows while retaining its status filter.
That filter uses a labeled native select with the existing status choices.

## Customer search

`RealCustomers` removes its local page-only query state. It sets `externalSearch`
on `Grid` and renders the existing `ListControls` and `ListPagination` for the
Customers section. The controls update URL search parameters and reset the
cursor; the page data supplies the resulting rows and pagination metadata.

## Verification points

Check search terms that exist only in secondary fields, combine notification
search with status, and search for a customer beyond the initially loaded page.
The source diff shows these wiring changes; it does not prove a historical
manual test run.
