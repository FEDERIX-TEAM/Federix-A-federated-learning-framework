import { expect, test } from "@playwright/test";
import { ConnectError, Code } from "@connectrpc/connect";
import { authApi, signIn, stack, storedSession } from "./helpers";

test("signed-out visitors are sent to sign in and come back where they were going", async ({ page }) => {
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/login\?next=%2Frounds$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("online")).toBeVisible();

  const { superAdmin } = stack();
  await page.getByLabel("Email").fill(superAdmin.email);
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-error")).toContainText(/invalid/i);
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Password", { exact: true }).fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByRole("heading", { level: 1, name: "Rounds" })).toBeVisible();
  await expect(page.getByTestId("user-menu").first()).toContainText("Ada Lovelace");
});

test("a reload keeps the session and signing out revokes it on the server", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  await expect(page.getByTestId("greeting")).toContainText("Ada");
  await page.reload();
  await expect(page.getByTestId("greeting")).toBeVisible();
  const session = await storedSession(page);
  expect(session).not.toBeNull();

  await page.getByTestId("user-menu").first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Your session ended")).toHaveCount(0);
  expect(await storedSession(page)).toBeNull();

  const err = await authApi().refreshToken({ refreshToken: session!.refreshToken }).catch((e) => e);
  expect(ConnectError.from(err).code).toBe(Code.Unauthenticated);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("an expired access token is refreshed without interrupting the user", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  const before = await storedSession(page);
  await page.waitForTimeout((stack().accessTtlSeconds + 1.5) * 1000);
  await page.getByTestId("sidebar-nav").getByRole("link", { name: "Metrics" }).click();
  await expect(page).toHaveURL(/\/metrics$/);
  await page.reload();
  await expect(page.getByTestId("sidebar-nav")).toBeVisible();
  const after = await storedSession(page);
  expect(after!.accessToken).not.toBe(before!.accessToken);
  expect(after!.refreshToken).not.toBe(before!.refreshToken);
});

test("two tabs refreshing at once never trip refresh-token reuse detection", async ({ context, page }) => {
  await signIn(page, stack().superAdmin);
  const second = await context.newPage();
  await second.goto("/models");
  await expect(second.getByTestId("sidebar-nav")).toBeVisible();
  await page.waitForTimeout((stack().accessTtlSeconds + 1.5) * 1000);

  await Promise.all([page.reload(), second.reload()]);
  await expect(page.getByTestId("sidebar-nav")).toBeVisible();
  await expect(second.getByTestId("sidebar-nav")).toBeVisible();

  const session = await storedSession(page);
  const res = await authApi().refreshToken({ refreshToken: session!.refreshToken });
  expect(res.accessToken).toBeTruthy();
});

test("signing out in one tab signs out every tab", async ({ context, page }) => {
  await signIn(page, stack().superAdmin);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByTestId("sidebar-nav")).toBeVisible();
  await page.getByTestId("user-menu").first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(second).toHaveURL(/\/login/);
});

test("a session ended on the server sends the user back to sign in with an explanation", async ({ page }) => {
  await signIn(page, stack().superAdmin, "/rounds");
  const session = await storedSession(page);
  await authApi().logout({}, { headers: { authorization: `Bearer ${session!.accessToken}` } });
  await page.waitForTimeout((stack().accessTtlSeconds + 1.5) * 1000);
  await page.getByTestId("sidebar-nav").getByRole("link", { name: "Models" }).click();
  await expect(page).toHaveURL(/\/models$/);
  await page.reload();
  await expect(page).toHaveURL(/\/login\?next=%2Fmodels&reason=expired/);
  await expect(page.getByTestId("login-notice")).toHaveText("Your session ended. Sign in again to continue.");
});
