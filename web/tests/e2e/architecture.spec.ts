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
  await expect(
    page.getByText("1005 matching customers", { exact: true }),
  ).toBeVisible();
  const first = await page.locator("tbody tr").first().textContent();
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.locator("tbody tr").first()).not.toHaveText(first!);
  await page
    .getByLabel("Search all customers", { exact: true })
    .fill("Customer 1005");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByText("1 matching customers", { exact: true }),
  ).toBeVisible();
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
