"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline } from "@/components/charts/LineChart";
import type { ConvergencePoint, OverviewResponse } from "@/gen/admin_pb";
import { compact, percent } from "@/lib/format";
import { changeOf, type Delta } from "@/lib/overview";
import { Skeleton } from "./Panel";
import styles from "./overview.module.css";

function Tile({ label, value, sub, delta, trend, trendLabel, testId }: { label: string; value: string | null; sub?: string; delta?: Delta | null; trend?: number[]; trendLabel?: string; testId: string }) {
  const Icon = !delta ? null : delta.good === null ? Minus : delta.good ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={styles.tile} data-testid={testId}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value ?? <Skeleton height={30} width={96} />}</span>
      <span className={styles.tileFoot}>
        {delta && Icon ? (
          <span className={styles.delta} data-good={delta.good === null ? undefined : String(delta.good)}>
            <Icon size={14} />
            {delta.text}
          </span>
        ) : null}
        {sub ? <span className={styles.tileSub}>{sub}</span> : null}
      </span>
      {trend && trend.length > 1 ? (
        <div className={styles.tileTrend}>
          <Sparkline data={trend} label={trendLabel ?? label} />
        </div>
      ) : null}
    </div>
  );
}

export function StatTiles({ overview, convergence }: { overview?: OverviewResponse; convergence?: ConvergencePoint[] }) {
  const acc = (convergence ?? []).map((p) => p.globalAccuracy);
  const loss = (convergence ?? []).map((p) => p.globalLoss);
  const latestAcc = acc.length ? acc.at(-1)! : (overview?.latestModelAccuracy ?? null);
  const latestLoss = loss.length ? loss.at(-1)! : (overview?.latestModelLoss ?? null);
  const loading = !overview;
  return (
    <section className={styles.tiles} aria-label="Key figures">
      <Tile
        testId="tile-accuracy"
        label="Model accuracy"
        value={loading ? null : percent(latestAcc)}
        delta={changeOf(acc, true, "pts")}
        sub={acc.length < 2 && overview ? (overview.latestModelVersion ? `Model v${overview.latestModelVersion}` : "No model yet") : undefined}
        trend={acc}
        trendLabel={`Accuracy over the last ${acc.length} rounds`}
      />
      <Tile
        testId="tile-loss"
        label="Model loss"
        value={loading ? null : latestLoss === null ? "—" : latestLoss.toFixed(3)}
        delta={changeOf(loss, false, "abs")}
        trend={loss}
        trendLabel={`Loss over the last ${loss.length} rounds`}
      />
      <Tile
        testId="tile-rounds"
        label="Rounds completed"
        value={loading ? null : compact(overview.completedRounds)}
        sub={overview ? (overview.latestModelVersion ? `Serving model v${overview.latestModelVersion}` : "No model published yet") : undefined}
      />
      <Tile
        testId="tile-clients"
        label="Clients"
        value={loading ? null : compact(overview.totalClients)}
        sub={overview ? `${compact(overview.activeClients)} active · ${compact(overview.bannedClients)} banned` : undefined}
      />
    </section>
  );
}
