import { describe, expect, it } from "vitest";
import { describeEvent, parsePayload, type FeedEvent } from "@/lib/events";
import { bytes, countdown, duration, niceTicks, percent, relativeTime } from "@/lib/format";
import { changeOf, stepOf } from "@/lib/overview";

const ev = (type: string, payload: Record<string, unknown>): FeedEvent => ({ id: "1", type, at: "2026-11-12T10:00:00Z", payload });

describe("describeEvent", () => {
  it("turns round events into plain sentences, naming rounds by number", () => {
    const numbers = new Map([["r-1", 7]]);
    expect(describeEvent(ev("round_started", { round_id: "r-1", round_number: 7, max_clients: 5 })).title).toBe("Round 7 started");
    expect(describeEvent(ev("round_ready", { round_id: "r-1", reason: "all_submitted", update_count: 3 }), numbers)).toMatchObject({
      title: "Round 7 is ready to aggregate",
      detail: "Because every participant submitted · 3 updates",
      tone: "violet",
    });
    expect(describeEvent(ev("round_completed", { round_id: "r-1", model_version: 8, accuracy: 0.9123 }), numbers)).toMatchObject({
      title: "Round 7 complete",
      detail: "Model v8 · accuracy 91.2%",
      tone: "ok",
    });
    expect(describeEvent(ev("round_failed", { round_id: "unknown", reason: "FL server: no update passed validation" })).title).toBe("The round failed");
  });

  it("describes updates with their outcome, utility and size", () => {
    const ok = describeEvent(ev("round_update_received", { round_id: "r", client_id: "abcdef1234567", status: "compressed", utility_score: 0.8312, bytes: 20480 }));
    expect(ok).toMatchObject({ title: "Update accepted, compressed from abcdef12", detail: "The round · utility 0.83 · 20.0 KB", tone: "ok" });
    expect(describeEvent(ev("round_update_received", { client_id: "c1", status: "rejected" })).tone).toBe("bad");
  });

  it("falls back gracefully for unknown events and bad payloads", () => {
    expect(describeEvent(ev("something_new", {})).title).toBe("something new");
    expect(parsePayload("not json")).toEqual({});
    expect(parsePayload("[1,2]")).toEqual({});
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("format", () => {
  it("formats percentages, sizes and durations", () => {
    expect(percent(0.8771)).toBe("87.7%");
    expect(percent(null)).toBe("—");
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(duration("2026-01-01T00:00:00Z", "2026-01-01T00:02:05Z")).toBe("2m 5s");
    expect(duration("2026-01-01T00:00:00Z", "bad")).toBe("—");
  });

  it("counts down and describes relative times", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(countdown("2026-01-01T00:01:05Z", now)).toBe("1:05");
    expect(countdown("2026-01-01T02:30:00Z", now)).toBe("2h 30m");
    expect(countdown("2025-12-31T23:00:00Z", now)).toBe("0:00");
    expect(relativeTime("2025-12-31T23:59:50Z", now)).toBe("just now");
    expect(relativeTime("2025-12-31T23:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("", now)).toBe("—");
  });

  it("picks clean axis ticks", () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(1, 12, 6)).toEqual([2.5, 5, 7.5, 10]);
    expect(niceTicks(1, 12, 6, true)).toEqual([4, 8, 12]);
    expect(niceTicks(1, 3, 6, true)).toEqual([1, 2, 3]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });
});

describe("overview logic", () => {
  it("reports change against the previous round in the right direction", () => {
    expect(changeOf([0.8, 0.85], true, "pts")).toEqual({ text: "+5.0 pts vs previous round", good: true });
    expect(changeOf([0.5, 0.42], false, "abs")).toEqual({ text: "−0.080 vs previous round", good: true });
    expect(changeOf([0.5, 0.6], false, "abs")?.good).toBe(false);
    expect(changeOf([0.5, 0.5], true, "pts")).toEqual({ text: "No change vs previous round", good: null });
    expect(changeOf([0.5], true, "pts")).toBeNull();
  });

  it("places the round on its progress steps", () => {
    expect(stepOf({ currentRoundStatus: "active", currentRoundReadyAt: "" })).toBe(0);
    expect(stepOf({ currentRoundStatus: "active", currentRoundReadyAt: "2026-01-01T00:00:00Z" })).toBe(1);
    expect(stepOf({ currentRoundStatus: "aggregating", currentRoundReadyAt: "x" })).toBe(2);
  });
});
