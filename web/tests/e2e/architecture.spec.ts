import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

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

test("sessions renew silently before expiry and restore expired cookies", async ({
  page,
  context,
}) => {
  const cookie = (await context.cookies()).find(
    (item) => item.name === "welio_access",
  )!;
  const [header, encoded] = cookie.value.split(".");
  const claims = JSON.parse(Buffer.from(encoded, "base64url").toString());
  claims.exp = Math.floor(Date.now() / 1_000) + 30;
  const payload = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  const signature = createHmac(
    "sha256",
    "welio-browser-tests-only-secret-12345",
  )
    .update(payload)
    .digest("base64url");
  await context.addCookies([{ ...cookie, value: `${payload}.${signature}` }]);
  const account = await context.request.get(`${api}/v1/me`, {
    headers: { Origin: "http://127.0.0.1:3101" },
  });
  expect(account.ok()).toBeTruthy();
  expect(Number(account.headers()["x-welio-access-ttl"])).toBeLessThanOrEqual(
    30,
  );
  expect(account.headers()["access-control-expose-headers"]).toContain(
    "X-Welio-Access-TTL",
  );
  let refreshes = 0;
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/refresh")) refreshes++;
    if (request.isNavigationRequest() && request.resourceType() === "document")
      documents.push(request.url());
  });
  await page.clock.install();
  await page.goto("/dashboard/services");
  await expect(
    page.getByRole("heading", { name: "Services", exact: true }),
  ).toBeVisible();
  await expect.poll(() => refreshes).toBe(1);
  await expect(page).toHaveURL(/\/dashboard\/services$/);
  expect(documents).toHaveLength(1);
  await expect
    .poll(
      async () =>
        (await context.cookies()).find((item) => item.name === "welio_access")
          ?.value,
    )
    .not.toBe(cookie.value);

  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add service", exact: true });
  await editor
    .getByLabel("Service name", { exact: true })
    .fill("Unsaved session renewal check");
  await context.clearCookies({ name: "welio_access" });
  await page.clock.fastForward(14 * 60 * 1_000 + 1_000);
  await expect.poll(() => refreshes).toBe(2);
  await expect(editor.getByLabel("Service name", { exact: true })).toHaveValue(
    "Unsaved session renewal check",
  );
  await expect(editor).toBeVisible();
  expect(documents).toHaveLength(1);
  await expect
    .poll(async () =>
      (await context.cookies()).some((item) => item.name === "welio_access"),
    )
    .toBeTruthy();
  await page.keyboard.press("Escape");

  await context.clearCookies({ name: "welio_access" });
  await page.goto("/dashboard/settings?tab=security");
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=security$/);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(refreshes).toBe(3);
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
  let accountChecks = 0;
  let documents = 0;
  page.on("request", (request) => {
    if (request.url() === `${api}/v1/me`) accountChecks++;
    if (request.isNavigationRequest() && request.resourceType() === "document")
      documents++;
  });
  await page.goto("/dashboard");
  await expect(page.getByText("1005", { exact: true })).toBeVisible();
  await expect.poll(() => accountChecks).toBe(1);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/dashboard\/customers\?/, async (route) => {
    if (route.request().headers().rsc === "1") await waiting;
    await route.continue();
  });
  try {
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await expect(
      page.getByRole("status", { name: "Opening Customers" }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();
  expect(accountChecks).toBe(1);
  expect(documents).toBe(1);
  await expect(page.getByRole("searchbox")).toHaveCount(1);
  await expect(page.getByText("1005 records", { exact: true })).toBeVisible();
  const first = await page.locator("tbody tr").first().textContent();
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.locator("tbody tr").first()).not.toHaveText(first!);
  await page
    .getByRole("searchbox", { name: "Search customers", exact: true })
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

test("table search and popover filters preserve list state and count footers", async ({
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
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  await page.getByRole("button", { name: "Status", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("cancelled");
  await expect(page).not.toHaveURL(/status=cancelled/);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page).toHaveURL(/status=cancelled/);
  await page
    .getByRole("button", { name: "Filter by date", exact: true })
    .click();
  await page.getByLabel("Start date", { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page).toHaveURL(/from=2026-10-01/);
  await expect(page).toHaveURL(/status=cancelled/);
  await page
    .getByRole("button", { name: "Status: cancelled", exact: true })
    .click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(page).toHaveURL(/from=2026-10-01/);
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
