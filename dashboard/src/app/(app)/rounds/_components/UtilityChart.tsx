"use client";

import type { AdminUpdateEntry } from "@/gen/admin_pb";
import { bytes } from "@/lib/format";
import { stageOf, tierOf } from "@/lib/roundView";
import styles from "./detail.module.css";

export function UtilityChart({ updates, low, high }: { updates: AdminUpdateEntry[]; low: number; high: number }) {
  const scored = updates.filter((u) => u.stage !== "prepared" || u.utilityScore > 0);
  const rows = [...scored].sort((a, b) => b.utilityScore - a.utilityScore);
  const stages = [...new Set(rows.map((u) => u.stage))];
  if (!rows.length) return null;
  return (
    <figure className={styles.utility} aria-label="Utility score of each update">
      <div className={styles.utilityLegend}>
        {stages.map((s) => {
          const st = stageOf(s);
          return (
            <span key={s} className={styles.legendItem}>
              <span className={styles.legendSwatch} data-tone={st.tone} />
              {st.label}
            </span>
          );
        })}
        <span className={styles.legendItem}>
          <span className={styles.legendRule} />
          Tier thresholds
        </span>
      </div>
      <div className={styles.utilityPlot}>
        <span className={styles.threshold} style={{ left: `${low * 100}%` }} aria-hidden="true">
          <span>low {low.toFixed(2)}</span>
        </span>
        <span className={styles.threshold} style={{ left: `${high * 100}%` }} aria-hidden="true">
          <span>high {high.toFixed(2)}</span>
        </span>
        <ol className={styles.bars}>
          {rows.map((u) => {
            const st = stageOf(u.stage);
            const name = u.clientName || u.clientId.slice(0, 8);
            return (
              <li key={u.updateId} className={styles.barRow} tabIndex={0} aria-label={`${name}: utility ${u.utilityScore.toFixed(3)}, ${st.label}`}>
                <span className={styles.barLabel} title={u.clientId}>
                  {name}
                </span>
                <span className={styles.barTrack}>
                  <span className={styles.bar} data-tone={st.tone} style={{ width: `${Math.max(0.5, Math.min(1, u.utilityScore) * 100)}%` }} />
                  <span className={styles.barValue} style={{ left: `${Math.min(1, u.utilityScore) * 100}%` }}>
                    {u.utilityScore.toFixed(2)}
                  </span>
                </span>
                <span className={styles.barTip} role="presentation">
                  <strong>{u.utilityScore.toFixed(3)}</strong> utility · {st.label}
                  <br />
                  {tierOf(u.compressionLevel, u.compressionRatio)} · {bytes(Number(u.bytes))}
                </span>
              </li>
            );
          })}
        </ol>
        <div className={styles.axis} aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span key={t} style={{ left: `${t * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
