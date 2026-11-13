import { describe, expect, it } from "vitest";
import { CompressionLevel, RoundStatus } from "@/gen/common_pb";
import { can, canAccess, restrictionFor } from "@/lib/nav";
import { isStatusFilter, stageOf, tierOf, timelineOf, validateStart, validateStopReason, type TimelineInput } from "@/lib/roundView";

const limits = { minClients: 2, maxClients: 50 };

describe("validateStart", () => {
  it("accepts a sensible round and converts minutes to seconds", () => {
    expect(validateStart({ maxClients: "10", deadlineMinutes: "15", notes: "  baseline  " }, limits)).toEqual({
      errors: {},
      value: { maxClients: 10, deadlineSeconds: 900, notes: "baseline" },
    });
    expect(validateStart({ maxClients: "2", deadlineMinutes: "0.5", notes: "" }, limits).errors.deadlineMinutes).toMatch(/at least 1 minute/);
  });

  it("explains every problem against the configured limits", () => {
    const { errors, value } = validateStart({ maxClients: "1", deadlineMinutes: "abc", notes: "x".repeat(501) }, limits);
    expect(value).toBeUndefined();
    expect(errors.maxClients).toMatch(/At least 2/);
    expect(errors.deadlineMinutes).toMatch(/minutes/);
    expect(errors.notes).toMatch(/501/);
    expect(validateStart({ maxClients: "51", deadlineMinutes: "10", notes: "" }, limits).errors.maxClients).toMatch(/At most 50/);
    expect(validateStart({ maxClients: "3.5", deadlineMinutes: "10", notes: "" }, limits).errors.maxClients).toMatch(/whole number/);
    expect(validateStart({ maxClients: "3", deadlineMinutes: "2000", notes: "" }, limits).errors.deadlineMinutes).toMatch(/24 hours/);
  });

  it("requires a real reason to stop a round", () => {
    expect(validateStopReason(" a ")).toMatch(/at least 3/);
    expect(validateStopReason("wrong mu")).toBeNull();
    expect(validateStopReason("x".repeat(501))).toMatch(/500/);
  });
});

const base: TimelineInput = {
  status: RoundStatus.ACTIVE,
  startedAt: "2026-01-01T00:00:00Z",
  readyAt: "",
  readyReason: "",
  aggregatingStartedAt: "",
  completedAt: "",
  endReason: "",
  modelVersionAfter: 0,
};

describe("timelineOf", () => {
  const states = (input: TimelineInput) => timelineOf(input).map((s) => s.state);

  it("follows a running round step by step", () => {
    expect(states(base)).toEqual(["done", "current", "todo", "todo"]);
    expect(states({ ...base, readyAt: "2026-01-01T00:05:00Z", readyReason: "all_submitted" })).toEqual(["done", "done", "current", "todo"]);
    expect(timelineOf({ ...base, readyAt: "x", readyReason: "all_submitted" })[1]!.note).toBe("Every participant submitted");
    expect(states({ ...base, status: RoundStatus.AGGREGATING, readyAt: "x", aggregatingStartedAt: "y" })).toEqual(["done", "done", "done", "current"]);
  });

  it("ends with the published model or the reason it failed", () => {
    const done = timelineOf({ ...base, status: RoundStatus.COMPLETE, readyAt: "a", aggregatingStartedAt: "b", completedAt: "c", modelVersionAfter: 4 });
    expect(done.map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    expect(done[3]).toMatchObject({ label: "Complete", note: "Published model v4" });
    const stopped = timelineOf({ ...base, status: RoundStatus.ABORTED, completedAt: "c", endReason: "wrong config" });
    expect(stopped.map((s) => s.state)).toEqual(["done", "skipped", "skipped", "failed"]);
    expect(stopped[3]).toMatchObject({ label: "Stopped", note: "wrong config" });
    expect(timelineOf({ ...base, status: RoundStatus.FAILED, readyAt: "a", aggregatingStartedAt: "b", completedAt: "c", endReason: "FL server: x" })[3]!.label).toBe("Failed");
  });
});

describe("update labels", () => {
  it("names each stage and tier in plain words", () => {
    expect(stageOf("prepared")).toEqual({ label: "Uploading", tone: "accent" });
    expect(stageOf("uploaded").label).toBe("Uploaded");
    expect(stageOf("rejected").tone).toBe("bad");
    expect(stageOf("weird").label).toBe("Pending");
    expect(tierOf(CompressionLevel.NONE, 1)).toBe("High · full update");
    expect(tierOf(CompressionLevel.FULL, 0.1)).toBe("Low · 10% kept");
    expect(tierOf(CompressionLevel.PARTIAL, 0.5)).toBe("Medium · 50% kept");
    expect(tierOf(CompressionLevel.UNSPECIFIED, 0)).toBe("—");
  });

  it("only accepts known status filters from the URL", () => {
    expect(isStatusFilter("complete")).toBe(true);
    expect(isStatusFilter(null)).toBe(true);
    expect(isStatusFilter("drop table")).toBe(false);
  });
});

describe("round permissions", () => {
  it("mirror the backend's RBAC rules", () => {
    expect(can("fl_engineer", "startRound")).toBe(true);
    expect(can("fl_engineer", "stopRound")).toBe(false);
    expect(can("viewer", "startRound")).toBe(false);
    expect(can("admin", "stopRound")).toBe(true);
    expect(canAccess("viewer", "/rounds")).toBe(true);
    expect(canAccess("viewer", "/rounds/abc")).toBe(false);
    expect(canAccess("fl_engineer", "/rounds/abc")).toBe(true);
    expect(restrictionFor("/rounds/abc")?.label).toBe("round details");
    expect(restrictionFor("/rounds")).toBeUndefined();
  });
});
