import { CompressionLevel, RoundStatus } from "@/gen/common_pb";
import type { Tone } from "@/components/ui";

export interface StartInput {
  maxClients: string;
  deadlineMinutes: string;
  notes: string;
}

export interface StartLimits {
  minClients: number;
  maxClients: number;
}

export type StartErrors = Partial<Record<keyof StartInput, string>>;

export function validateStart(input: StartInput, limits: StartLimits): { errors: StartErrors; value?: { maxClients: number; deadlineSeconds: number; notes: string } } {
  const errors: StartErrors = {};
  const max = Number(input.maxClients);
  const minutes = Number(input.deadlineMinutes);
  if (!input.maxClients.trim() || !Number.isInteger(max)) errors.maxClients = "Enter a whole number of clients.";
  else if (max < limits.minClients) errors.maxClients = `At least ${limits.minClients}: the minimum clients per round.`;
  else if (max > limits.maxClients) errors.maxClients = `At most ${limits.maxClients}: the configured maximum per round.`;
  if (!input.deadlineMinutes.trim() || !Number.isFinite(minutes)) errors.deadlineMinutes = "Enter the deadline in minutes.";
  else if (minutes < 1) errors.deadlineMinutes = "The deadline must be at least 1 minute.";
  else if (minutes > 24 * 60) errors.deadlineMinutes = "The deadline can be at most 24 hours.";
  if (input.notes.length > 500) errors.notes = `Keep notes under 500 characters (${input.notes.length} now).`;
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { maxClients: max, deadlineSeconds: Math.round(minutes * 60), notes: input.notes.trim() } };
}

export function validateStopReason(reason: string): string | null {
  const text = reason.trim();
  if (text.length < 3) return "Say briefly why the round is being stopped (at least 3 characters).";
  if (text.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

export type StepState = "done" | "current" | "todo" | "failed" | "skipped";

export interface TimelineStep {
  key: "started" | "ready" | "aggregating" | "end";
  label: string;
  at: string;
  state: StepState;
  note?: string;
}

const READY: Record<string, string> = {
  all_submitted: "Every participant submitted",
  max_updates: "Reached its update limit",
  deadline: "The deadline passed",
};

export interface TimelineInput {
  status: RoundStatus;
  startedAt: string;
  readyAt: string;
  readyReason: string;
  aggregatingStartedAt: string;
  completedAt: string;
  endReason: string;
  modelVersionAfter: number;
}

export function timelineOf(d: TimelineInput): TimelineStep[] {
  const ended = [RoundStatus.COMPLETE, RoundStatus.FAILED, RoundStatus.ABORTED].includes(d.status);
  const endLabel = d.status === RoundStatus.FAILED ? "Failed" : d.status === RoundStatus.ABORTED ? "Stopped" : "Complete";
  const endNote =
    d.status === RoundStatus.COMPLETE ? (d.modelVersionAfter ? `Published model v${d.modelVersionAfter}` : "") : d.endReason || undefined;
  const reached = (at: string) => Boolean(at);
  const step = (key: TimelineStep["key"], label: string, at: string, note?: string): TimelineStep => ({ key, label, at, state: "todo", note });

  const steps = [
    step("started", "Started", d.startedAt),
    step("ready", "Ready", d.readyAt, READY[d.readyReason]),
    step("aggregating", "Aggregating", d.aggregatingStartedAt),
    step("end", endLabel, ended ? d.completedAt : "", endNote),
  ];
  steps[0]!.state = "done";
  for (const s of steps.slice(1, 3)) s.state = reached(s.at) ? "done" : ended ? "skipped" : "todo";
  if (ended) {
    steps[3]!.state = d.status === RoundStatus.COMPLETE ? "done" : "failed";
  } else {
    const current = d.status === RoundStatus.AGGREGATING ? 2 : reached(d.readyAt) ? 1 : 0;
    for (let i = 0; i <= current; i += 1) steps[i]!.state = "done";
    steps[Math.min(3, current + 1)]!.state = "current";
  }
  return steps;
}

export function stageOf(stage: string): { label: string; tone: Tone } {
  switch (stage) {
    case "accepted":
      return { label: "Accepted", tone: "ok" };
    case "compressed":
      return { label: "Compressed", tone: "info" };
    case "rejected":
      return { label: "Rejected", tone: "bad" };
    case "uploaded":
      return { label: "Uploaded", tone: "violet" };
    case "prepared":
      return { label: "Uploading", tone: "accent" };
    default:
      return { label: "Pending", tone: "neutral" };
  }
}

export function tierOf(level: CompressionLevel, ratio: number): string {
  const pct = ratio > 0 && ratio < 1 ? ` · ${Math.round(ratio * 100)}% kept` : "";
  switch (level) {
    case CompressionLevel.NONE:
      return "High · full update";
    case CompressionLevel.PARTIAL:
      return `Medium${pct}`;
    case CompressionLevel.FULL:
      return `Low${pct}`;
    default:
      return "—";
  }
}

export const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Collecting" },
  { value: "aggregating", label: "Aggregating" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
  { value: "aborted", label: "Stopped" },
] as const;

export function isStatusFilter(value: string | null): value is (typeof STATUS_FILTERS)[number]["value"] {
  return STATUS_FILTERS.some((f) => f.value === (value ?? ""));
}

export function isRunning(status: RoundStatus): boolean {
  return status === RoundStatus.ACTIVE || status === RoundStatus.AGGREGATING;
}
