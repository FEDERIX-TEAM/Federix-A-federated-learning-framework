"use client";

import { useState } from "react";
import { LineChart as LineIcon } from "lucide-react";
import { LineChart } from "@/components/charts/LineChart";
import type { ConvergencePoint } from "@/gen/admin_pb";
import { percent } from "@/lib/format";
import { Empty, Panel, Skeleton } from "./Panel";
import styles from "./overview.module.css";

export function AccuracyPanel({ points, fetching }: { points?: ConvergencePoint[]; fetching: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = (points ?? []).map((p) => ({ x: p.roundNumber, y: p.globalAccuracy }));
  const first = points?.[0];
  const last = points?.at(-1);
  const subtitle = points && points.length >= 2 && first && last
    ? `${percent(first.globalAccuracy)} → ${percent(last.globalAccuracy)} over the last ${points.length} completed rounds`
    : "Global model accuracy on the FL server's test set after each round";

  return (
    <Panel
      title="Accuracy by round"
      subtitle={subtitle}
      className={styles.span2}
      testId="accuracy-panel"
      actions={
        <div className={styles.toggle} role="radiogroup" aria-label="Show as">
          <button type="button" role="radio" aria-checked={view === "chart"} onClick={() => setView("chart")}>
            Chart
          </button>
          <button type="button" role="radio" aria-checked={view === "table"} onClick={() => setView("table")}>
            Table
          </button>
        </div>
      }
    >
      {!points ? (
        <Skeleton height={260} />
      ) : !points.length ? (
        <Empty icon={<LineIcon size={20} />} title="No completed rounds yet" text="Accuracy appears here after the FL server aggregates the first round." />
      ) : view === "chart" ? (
        <LineChart
          data={data}
          label={`Accuracy by round, latest ${percent(last?.globalAccuracy)}. Use the arrow keys to read each round.`}
          formatY={(v) => `${Math.round(v * 100)}%`}
          formatX={(v) => `R${v}`}
          yDomain={[0, 1]}
          dimmed={fetching}
          tooltip={(i) => {
            const p = points[i]!;
            return {
              title: `Round ${p.roundNumber}`,
              rows: [
                { label: "accuracy", value: percent(p.globalAccuracy, 2) },
                { label: "loss", value: p.globalLoss.toFixed(4) },
              ],
            };
          }}
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col" className={styles.numCol}>Accuracy</th>
                <th scope="col" className={styles.numCol}>Loss</th>
                <th scope="col" className={styles.numCol}>Change in loss</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.roundNumber}>
                  <td>Round {p.roundNumber}</td>
                  <td className={styles.numCol}>{percent(p.globalAccuracy, 2)}</td>
                  <td className={styles.numCol}>{p.globalLoss.toFixed(4)}</td>
                  <td className={styles.numCol}>{p.deltaLoss === undefined ? "—" : `${p.deltaLoss > 0 ? "+" : ""}${p.deltaLoss.toFixed(4)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
