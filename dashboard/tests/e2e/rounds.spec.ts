import { expect, test } from "@playwright/test";
import { Federation } from "./federation";
import { signIn, stack } from "./helpers";

test.describe.configure({ mode: "serial" });

test("starting a round validates the form and opens the new round", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  await fed.ensureModel();
  await signIn(page, stack().superAdmin, "/rounds");

  await page.getByTestId("start-round").click();
  const dialog = page.getByRole("dialog", { name: "Start a round" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Maximum clients").fill("0");
  await dialog.getByLabel("Deadline (minutes)").fill("0");
  await dialog.getByRole("button", { name: "Start round" }).click();
  await expect(dialog).toContainText(/At least 1/);
  await expect(dialog).toContainText("at least 1 minute");

  await dialog.getByLabel("Maximum clients").fill("3");
  await dialog.getByRole("radio", { name: "15 min" }).click();
  await dialog.getByLabel("Notes (optional)").fill("dashboard e2e round");
  await dialog.getByRole("button", { name: "Start round" }).click();

  await expect(page).toHaveURL(/\/rounds\/[\w-]+$/);
  await expect(page.getByTestId("toast")).toContainText(/Round \d+ started/);
  await expect(page.getByTestId("round-status")).toContainText("Collecting");
  await expect(page.getByText("dashboard e2e round")).toBeVisible();
  await expect(page.getByTestId("tile-participants")).toContainText("0/3");
  await expect(page.getByTestId("timeline").locator("li").nth(1)).toHaveAttribute("data-state", "current");

  await page.goto("/rounds");
  await expect(page.getByTestId("running-round")).toContainText(/collecting updates/);
  await expect(page.getByTestId("start-round")).toBeDisabled();
});

test("a round's detail page fills in live and explains rejected updates", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  const round = await fed.startRound(3);
  await signIn(page, stack().superAdmin, `/rounds/${round.roundId}`);
  await expect(page.getByTestId("round-title")).toHaveText(`Round ${round.roundNumber}`);

  const a = await fed.newClient("hospital-a");
  const b = await fed.newClient("hospital-b");
  const c = await fed.newClient("hospital-c");
  for (const x of [a, b, c]) await fed.join(round.roundId, x);
  await expect(page.getByTestId("tile-participants")).toContainText("3/3");
  await expect(page.getByTestId("participants-table")).toContainText("hospital-b");

  const ua = await fed.submit(round.roundId, a);
  await fed.submit(round.roundId, b);
  const uc = await fed.submit(round.roundId, c);
  const updates = page.getByTestId("updates-table");
  await expect(updates.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("figure", { name: "Utility score of each update" }).getByRole("listitem")).toHaveCount(3);

  const version = await fed.complete(round.roundId, 0.83, 0.48, { [uc]: "update norm 41.2 is above 5x the round median" });
  await expect(page.getByTestId("round-status")).toContainText("Complete");
  await expect(page.getByTestId("tile-result")).toContainText("83.0%");
  await expect(page.getByTestId("tile-result")).toContainText(`model v${version}`);
  await expect(page.getByTestId("tile-updates")).toContainText("2/3");
  await expect(page.getByTestId("timeline").locator("li").last()).toContainText(`Published model v${version}`);
  const rejected = updates.locator(`tr[data-update="${uc}"]`);
  await expect(rejected).toContainText("Rejected");
  await expect(rejected).toContainText("update norm 41.2 is above 5x the round median");
  await expect(updates.locator(`tr[data-update="${ua}"]`)).not.toContainText("Rejected");
});

test("stopping a round needs a reason and shows why it ended", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  const round = await fed.startRound(2);
  await signIn(page, stack().superAdmin, "/rounds");

  await page.getByTestId("stop-running").click();
  const dialog = page.getByRole("dialog", { name: `Stop round ${round.roundNumber}?` });
  await dialog.getByRole("button", { name: "Stop round" }).click();
  await expect(dialog).toContainText("at least 3 characters");
  await dialog.getByLabel("Reason").fill("wrong learning rate");
  await dialog.getByRole("button", { name: "Stop round" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("toast")).toContainText(`Round ${round.roundNumber} stopped`);
  await expect(page.getByTestId("running-round")).toHaveCount(0);

  await page.getByRole("radio", { name: "Stopped" }).click();
  await expect(page).toHaveURL(/status=aborted/);
  const row = page.getByTestId("rounds-table").getByRole("row", { name: new RegExp(`Round ${round.roundNumber}\\b`) });
  await expect(row).toContainText("wrong learning rate");
  await row.getByRole("link").click();
  await expect(page.getByTestId("end-reason")).toContainText("wrong learning rate");
  await expect(page.getByTestId("timeline").locator("li").last()).toHaveAttribute("data-state", "failed");
});

test("a viewer can browse rounds but not open, start or stop them", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  await fed.startRound(2);
  await signIn(page, stack().viewer, "/rounds");
  await expect(page.getByTestId("rounds-table")).toBeVisible();
  await expect(page.getByTestId("start-round")).toHaveCount(0);
  await expect(page.getByTestId("stop-running")).toHaveCount(0);
  await expect(page.getByTestId("rounds-table").getByRole("link")).toHaveCount(0);
  await page.goto(`/rounds/${await fed.latestRoundId()}`);
  await expect(page.getByTestId("forbidden")).toContainText("You don’t have access to round details");
  await fed.stopRunningRounds();
});

test("an unknown round explains itself", async ({ page }) => {
  await signIn(page, stack().superAdmin, "/rounds/not-a-real-round");
  await expect(page.getByTestId("round-missing")).toContainText("This round doesn't exist");
  await page.getByRole("link", { name: "Back to rounds" }).click();
  await expect(page).toHaveURL(/\/rounds$/);
});
