import type { OverviewResponse } from "@/gen/admin_pb";

export interface Delta {
  text: string;
  good: boolean | null;
}

export function changeOf(points: number[], higherIsBetter: boolean, unit: "pts" | "abs"): Delta | null {
  if (points.length < 2) return null;
  const diff = points.at(-1)! - points.at(-2)!;
  if (Math.abs(diff) < 1e-9) return { text: "No change vs previous round", good: null };
  const sign = diff > 0 ? "+" : "−";
  const amount = unit === "pts" ? `${(Math.abs(diff) * 100).toFixed(1)} pts` : Math.abs(diff).toFixed(3);
  return { text: `${sign}${amount} vs previous round`, good: diff > 0 === higherIsBetter };
}

export function stepOf(o: Pick<OverviewResponse, "currentRoundStatus" | "currentRoundReadyAt">): number {
  if (o.currentRoundStatus === "aggregating") return 2;
  if (o.currentRoundReadyAt) return 1;
  return 0;
}
