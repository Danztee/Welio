import { test, expect } from "@playwright/test";

test("dashboard sections remain usable on desktop and mobile", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|server rendered|server-rendered/i.test(message.text())
    )
      hydrationErrors.push(message.text());
  });
  const response = await context.request.post(
    "http://127.0.0.1:8181/v1/auth/login",
    {
      headers: { Origin: "http://127.0.0.1:3101" },
      data: {
        email: "browser@example.test",
        password: "Welio-browser-test-2026!",
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const section of [
      "",
      "/appointments",
      "/customers",
      "/services",
      "/team",
      "/members",
      "/settings",
      "/settings?tab=security",
      "/settings?tab=business",
      "/settings?tab=booking",
      "/settings?tab=booking-page",
      "/notifications",
      "/time-off",
      "/receptionist",
    ]) {
      await page.goto(`/dashboard${section}`);
      await expect(page.locator("#dashboard-main")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Something went wrong" }),
      ).toHaveCount(0);
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        actual: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8)
          .map((el) => ({
            tag: el.tagName,
            id: el.id,
            classes: el.className,
            right: el.getBoundingClientRect().right,
          })),
      }));
      if (overflow.actual > overflow.width)
        await page.screenshot({
          path: testInfo.outputPath("overflow.png"),
          fullPage: true,
        });
      expect(
        overflow.actual,
        JSON.stringify({ section, ...overflow }),
      ).toBeLessThanOrEqual(overflow.width);
      if (
        [
          "/customers",
          "/appointments",
          "/services",
          "/team",
          "/notifications",
          "/time-off",
        ].includes(section)
      ) {
        await expect(page.getByRole("searchbox")).toHaveCount(1);
        await expect(
          page.getByRole("button", { name: "Apply filters" }),
        ).toHaveCount(0);
        await expect(
          page
            .locator("#dashboard-main")
            .getByText(/^[0-9]+ records?$/, { exact: true }),
        ).toBeVisible();
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `${width}-${section.slice(1).replaceAll("?", "-") || "overview"}.png`,
        ),
        fullPage: true,
      });
    }
    await page.goto("/onboarding?new=true");
    await expect(
      page.getByRole("button", { name: "Create business", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`${width}-onboarding.png`),
      fullPage: true,
    });
  }
  expect(hydrationErrors).toEqual([]);
});

test("auth screens share a compact layout on desktop and mobile", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/verify-email?email=hello%40example.com",
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await expect(page.locator("aside")).toHaveCount(0);
      if (route.startsWith("/verify-email"))
        await expect(page.locator("main input, main svg")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(
          `${width}-${route.split("?")[0].slice(1)}.png`,
        ),
        fullPage: true,
      });
    }
  }
});
