import { expect, type Page } from "@playwright/test";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "../../src/gen/auth_pb";
import { readState, type Account } from "./stack";

export const stack = () => readState();

export async function signIn(page: Page, account: Account, path = "/") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("sidebar-nav")).toBeVisible();
}

export async function storedSession(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("federix.session");
    return raw ? (JSON.parse(raw) as { accessToken: string; refreshToken: string }) : null;
  });
}

export function authApi() {
  return createClient(AuthService, createConnectTransport({ baseUrl: stack().apiUrl, useBinaryFormat: true }));
}
