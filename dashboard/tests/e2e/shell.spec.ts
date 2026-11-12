import { expect, test } from "@playwright/test";
import { signIn, stack } from "./helpers";

test("a viewer only sees the pages their role allows", async ({ page }) => {
  await signIn(page, stack().viewer);
  const nav = page.getByTestId("sidebar-nav");
  for (const label of ["Overview", "Metrics", "Rounds", "Models", "Configuration"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
  for (const label of ["Clients", "Enrollment", "Users", "Audit log", "System"]) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  }
  await page.goto("/users");
  await expect(page.getByTestId("forbidden")).toContainText("You don’t have access to Users");
  await expect(page.getByTestId("forbidden")).toContainText("Viewer");
});

test("a super admin sees every page", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  await expect(page.getByTestId("sidebar-nav").getByRole("link")).toHaveCount(10);
});

test("the theme choice is applied before the page renders and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, stack().superAdmin);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const response = await page.request.get("/");
  expect(await response.text()).toContain("federix.theme");
  await page.reload({ waitUntil: "commit" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(8, 12, 18)");

  await page.getByTestId("user-menu").first().click();
  await page.getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

test("the command palette finds pages and actions from the keyboard", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("enrol");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/enrollment$/);
  await expect(dialog).toHaveCount(0);

  await page.getByTestId("open-palette").click();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("zzz-nothing");
  await expect(dialog.getByText("No matches")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("connection status reflects the real backend and notices when it is unreachable", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  const status = page.getByTestId("connection-status");
  await expect(status).toHaveAttribute("data-state", "healthy");
  await status.click();
  const pop = page.getByRole("dialog", { name: "Service status" });
  await expect(pop).toContainText("MongoDB");
  await expect(pop).toContainText("connected");
  await expect(pop).toContainText("test");
  await page.keyboard.press("Escape");

  await page.route("**/federix.v1.SystemService/HealthCheck", (route) => route.abort("connectionrefused"));
  await expect(status).toHaveAttribute("data-state", "offline", { timeout: 8_000 });
  await expect(status).toContainText("Server unreachable");
  await page.unroute("**/federix.v1.SystemService/HealthCheck");
  await expect(status).toHaveAttribute("data-state", "healthy", { timeout: 8_000 });
});

test("the sidebar collapses on desktop and becomes a drawer on a phone", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  await page.setViewportSize({ width: 390, height: 800 });
  const nav = page.getByTestId("sidebar-nav");
  await expect(nav).not.toBeInViewport();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(nav).toBeInViewport();
  await nav.getByRole("link", { name: "Models" }).click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(nav).not.toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
