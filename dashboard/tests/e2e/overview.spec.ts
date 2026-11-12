import { expect, test } from "@playwright/test";
import { FlServerState } from "../../src/gen/common_pb";
import { Federation } from "./federation";
import { signIn, stack } from "./helpers";

test.describe.configure({ mode: "serial" });

test("a fresh federation shows clear empty states", async ({ page }) => {
  await signIn(page, stack().superAdmin);
  await expect(page.getByTestId("tile-rounds")).toContainText("0");
  await expect(page.getByTestId("current-round")).toContainText("No round running");
  await expect(page.getByTestId("accuracy-panel")).toContainText("No completed rounds yet");
  await expect(page.getByTestId("recent-rounds")).toContainText("No rounds yet");
  await expect(page.getByTestId("fl-server")).toContainText("hasn't reported yet");
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-state", "live");
  await expect(page.getByTestId("grafana-link")).toHaveAttribute("href", stack().grafanaUrl);
});

test("a round shows up live, from start to a new model, without reloading", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  await fed.ensureModel();
  await signIn(page, stack().superAdmin);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-state", "live");
  const feed = page.getByTestId("activity");
  const current = page.getByTestId("current-round");

  const round = await fed.startRound(3);
  await expect(feed.locator('[data-type="round_started"]').first()).toContainText(`Round ${round.roundNumber} started`);
  await expect(current).toContainText(`Round ${round.roundNumber}`);
  await expect(current).toContainText("Collecting");
  await expect(page.getByTestId("meter-participants")).toContainText("0 / 3");

  const a = await fed.newClient("e2e-a");
  const b = await fed.newClient("e2e-b");
  await fed.join(round.roundId, a);
  await fed.join(round.roundId, b);
  await expect(page.getByTestId("meter-participants")).toContainText("2 / 3");
  await expect(feed.locator('[data-type="round_client_joined"]')).toHaveCount(2);

  await fed.submit(round.roundId, a);
  await expect(page.getByTestId("meter-updates")).toContainText("1 / 2");
  await expect(feed.locator('[data-type="round_update_received"]').first()).toContainText(/Update accepted/);
  await fed.submit(round.roundId, b);

  await fed.complete(round.roundId, 0.62, 0.95);
  await expect(feed.locator('[data-type="round_completed"]').first()).toContainText(`Round ${round.roundNumber} complete`);
  await expect(current).toContainText("No round running");
  await expect(page.getByTestId("tile-accuracy")).toContainText("62.0%");
  await expect(page.getByTestId("recent-rounds").getByRole("row", { name: new RegExp(`Round ${round.roundNumber}`) })).toContainText("Complete");

  const second = await fed.startRound(1);
  const c = await fed.newClient("e2e-c");
  await fed.join(second.roundId, c);
  await fed.submit(second.roundId, c);
  await fed.complete(second.roundId, 0.71, 0.74);
  await expect(page.getByTestId("tile-accuracy")).toContainText("71.0%");
  await expect(page.getByTestId("tile-accuracy")).toContainText("+9.0 pts vs previous round");
  await expect(page.getByTestId("tile-loss")).toContainText("−0.210 vs previous round");

  const chart = page.getByTestId("accuracy-panel");
  await expect(chart.getByRole("img")).toHaveAttribute("aria-label", /latest 71\.0%/);
  await chart.getByRole("img").focus();
  await expect(chart).toContainText(`Round ${second.roundNumber}`);
  await page.keyboard.press("ArrowLeft");
  await expect(chart).toContainText("62.00%");
  await chart.getByRole("radio", { name: "Table" }).click();
  await expect(chart.getByRole("row")).toHaveCount(3);
  await expect(chart.getByRole("row").nth(1)).toContainText("71.00%");
});

test("the FL server card follows the brain's status reports", async ({ page }) => {
  const fed = await new Federation().signIn();
  await signIn(page, stack().superAdmin);
  await fed.reportFlServer(FlServerState.IDLE, "waiting for rounds; model v3");
  const card = page.getByTestId("fl-server");
  await expect(card).toContainText("Idle");
  await expect(card).toContainText("brain-e2e");
  await expect(card).toContainText("waiting for rounds; model v3");
  await fed.reportFlServer(FlServerState.ERROR, "round 9 failed", "aggregation error: bad update");
  await expect(card).toContainText("Error");
  await expect(card).toContainText("aggregation error: bad update");
  await expect(page.getByTestId("activity").locator('[data-type="fl_server_status"]').first()).toContainText("FL server reported an error");
  await fed.reportFlServer(FlServerState.IDLE, "recovered");
});

test("the live feed reconnects by itself after the access token expires", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  await signIn(page, stack().superAdmin);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-state", "live");
  await page.waitForTimeout((stack().accessTtlSeconds + 3) * 1000);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-state", "live");
  const round = await fed.startRound(2);
  await expect(page.getByTestId("activity").locator('[data-type="round_started"]').first()).toContainText(`Round ${round.roundNumber} started`);
  await expect(page).not.toHaveURL(/\/login/);
});

test("a viewer gets the same overview without the controls they can't use", async ({ page }) => {
  const fed = await new Federation().signIn();
  await fed.stopRunningRounds();
  await signIn(page, stack().viewer);
  await expect(page.getByTestId("tile-accuracy")).toContainText("71.0%");
  await expect(page.getByTestId("current-round")).toContainText("No round running");
  await expect(page.getByTestId("current-round").getByRole("link", { name: "Go to rounds" })).toHaveCount(0);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-state", "live");
});
