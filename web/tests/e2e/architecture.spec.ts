import { test, expect } from "@playwright/test";

const api = "http://127.0.0.1:8181";

test.beforeEach(async ({ context }) => {
  const response = await context.request.post(`${api}/v1/auth/login`, {
    headers: { Origin: "http://127.0.0.1:3101" },
    data: {
      email: "browser@example.test",
      password: "Welio-browser-test-2026!",
    },
  });
  expect(response.ok()).toBeTruthy();
  expect((await context.cookies()).map((cookie) => cookie.name)).toEqual(
    expect.arrayContaining(["welio_access", "welio_refresh"]),
  );
});

test("expired access cookie renews through Go and preserves the destination", async ({
  page,
  context,
}) => {
  await context.clearCookies({ name: "welio_access" });
  const refreshes: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/refresh")) refreshes.push(request.url());
  });
  await page.goto("/dashboard/settings?tab=security");
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=security$/);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(refreshes).toHaveLength(1);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "welio_access"),
  ).toBeTruthy();
});

test("two tabs share a refresh without losing the session", async ({
  page,
  context,
}) => {
  await context.clearCookies({ name: "welio_access" });
  const second = await context.newPage();
  let refreshes = 0;
  context.on("request", (request) => {
    if (request.url().endsWith("/auth/refresh")) refreshes++;
  });
  await Promise.all([
    page.goto("/session/renew?next=%2Fdashboard%2Fservices"),
    second.goto("/session/renew?next=%2Fdashboard%2Fservices"),
  ]);
  await expect(page).toHaveURL(/\/dashboard\/services$/);
  await expect(second).toHaveURL(/\/dashboard\/services$/);
  expect(refreshes).toBe(1);
});

test("revoked session returns to sign-in with the intended destination", async ({
  page,
  context,
}) => {
  const response = await context.request.post(`${api}/v1/auth/logout`, {
    headers: { Origin: "http://127.0.0.1:3101" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/dashboard/time-off");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Ftime-off$/);
});

test("customer lists expose pagination and overview totals include all records", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByText("1005", { exact: true })).toBeVisible();
  await page.goto("/dashboard/customers");
  await expect(page.getByRole("searchbox")).toHaveCount(1);
  await expect(page.getByText("1005 records", { exact: true })).toBeVisible();
  const first = await page.locator("tbody tr").first().textContent();
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.locator("tbody tr").first()).not.toHaveText(first!);
  await page
    .getByLabel("Search all customers", { exact: true })
    .fill("Customer 1005");
  await expect(page.getByText("1 record", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Customer 1005");
});

test("UI sign-in and service creation persist through the generated SDK", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/sign-in?next=%2Fdashboard%2Fservices");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Welio-browser-test-2026!");
  const login = page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/auth/login` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await login).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/dashboard\/services$/);
  expect((await context.cookies()).map((cookie) => cookie.name)).toEqual(
    expect.arrayContaining(["welio_access", "welio_refresh"]),
  );

  const serviceName = `SDK regression service ${Date.now()}`;
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add service", exact: true });
  await editor.getByLabel("Service name", { exact: true }).fill(serviceName);
  await editor.getByLabel("Duration (minutes)", { exact: true }).fill("90");
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  const persisted = page.getByRole("row").filter({ hasText: serviceName });
  await expect(persisted).toHaveCount(1);
  await expect(persisted).toContainText("90 min");
});

test("table search and filters apply without buttons and share count footers", async ({
  page,
}) => {
  await page.goto("/dashboard/services");
  const initialCount = await page.locator("tbody tr").count();
  const search = page.getByRole("searchbox");
  await expect(search).toHaveCount(1);
  await search.fill("a-service-that-does-not-exist");
  await expect(page.getByText("0 records", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(
    page.getByText(
      `${initialCount} ${initialCount === 1 ? "record" : "records"}`,
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("/dashboard/appointments");
  await expect(page.getByRole("button", { name: "Apply filters" })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Appointment status", { exact: true })
    .selectOption("cancelled");
  await expect(page).toHaveURL(/status=cancelled/);
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await expect(page).toHaveURL(/from=2026-10-01/);
  await expect(page).toHaveURL(/status=cancelled/);
  await page.getByLabel("Appointment status", { exact: true }).selectOption("");
  await expect(page).not.toHaveURL(/status=/);
  await expect(page.getByText("0 records", { exact: true })).toBeVisible();
});

test("team picker dropdown stays aligned with the complete multi-select", async ({
  page,
  context,
}) => {
  const workspaces = await context.request.get(`${api}/v1/workspaces`);
  const [{ workspace }] = await workspaces.json();
  const headers = {
    Origin: "http://127.0.0.1:3101",
    "X-Welio-Workspace": workspace.id,
  };
  const staff = await context.request.post(`${api}/v1/catalog/staff`, {
    headers,
    data: {
      name: "Picker Test Member",
      email: "picker@example.test",
      job_title: "Cleaner",
      is_active: true,
      schedule: {
        start: "09:00",
        end: "17:00",
        days: [1, 2, 3, 4, 5],
        break_start: "12:00",
        break_end: "13:00",
      },
    },
  });
  expect(staff.ok()).toBeTruthy();
  const service = await context.request.post(`${api}/v1/catalog/services`, {
    headers,
    data: {
      name: "Picker Alignment Service",
      description: "Test service",
      duration_minutes: 60,
      price: 1000,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      is_active: true,
      staff_ids: [(await staff.json()).id],
    },
  });
  expect(service.ok()).toBeTruthy();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/services");
    const row = page
      .getByRole("row")
      .filter({ hasText: "Picker Alignment Service" });
    await row.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Assign team members" }).click();
    const picker = page.getByRole("combobox", {
      name: "Available team members",
    });
    await picker.click();
    await expect(
      page.getByRole("option", { name: "Picker Test Member" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("option", { name: "Browser Owner" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const anchor = await page
          .locator('[data-slot="combobox-chips"]')
          .boundingBox();
        const popup = await page
          .locator('[data-slot="combobox-content"]')
          .boundingBox();
        return Boolean(
          anchor &&
            popup &&
            Math.abs(anchor.x - popup.x) < 2 &&
            Math.abs(anchor.width - popup.width) < 2,
        );
      })
      .toBeTruthy();
    await page.getByRole("option", { name: "Browser Owner" }).click();
    await picker.click();
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(
      page.getByText("All team members selected.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});
