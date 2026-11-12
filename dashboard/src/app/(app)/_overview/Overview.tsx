"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/components/auth";
import { useRuntime } from "@/components/runtime";
import { ROLE_LABEL } from "@/lib/nav";
import { useConvergence, useFlStatus, useOverview, useRecentRounds } from "@/lib/queries";
import { AccuracyPanel } from "./AccuracyPanel";
import { ActivityFeed } from "./ActivityFeed";
import { CurrentRound } from "./CurrentRound";
import { FlServerCard } from "./FlServerCard";
import { RecentRounds } from "./RecentRounds";
import { StatTiles } from "./StatTiles";
import styles from "./overview.module.css";

function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Overview() {
  const { profile } = useAuth();
  const { grafanaUrl } = useRuntime();
  const overview = useOverview();
  const convergence = useConvergence(30);
  const rounds = useRecentRounds(6);
  const fl = useFlStatus();
  const [hello, setHello] = useState("Welcome");
  useEffect(() => setHello(greeting(new Date().getHours())), []);

  const roundNumbers = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rounds.data ?? []) map.set(r.roundId, r.roundNumber);
    if (overview.data?.currentRoundId) map.set(overview.data.currentRoundId, overview.data.currentRoundNumber);
    return map;
  }, [rounds.data, overview.data]);

  if (!profile) return null;
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{ROLE_LABEL[profile.role]}</p>
          <h2 className={styles.hello} data-testid="greeting">
            {hello}, {profile.name.split(" ")[0]}
          </h2>
        </div>
        {grafanaUrl ? (
          <a className={styles.grafana} href={grafanaUrl} target="_blank" rel="noreferrer noopener" data-testid="grafana-link">
            Open in Grafana
            <ExternalLink size={14} />
          </a>
        ) : null}
      </section>

      <StatTiles overview={overview.data} convergence={convergence.data} />

      <div className={styles.grid}>
        <AccuracyPanel points={convergence.data} fetching={convergence.isFetching && Boolean(convergence.data)} />
        <CurrentRound overview={overview.data} role={profile.role} />
        <RecentRounds rounds={rounds.data} />
        <div className={styles.stack}>
          <FlServerCard status={fl.data} />
          <ActivityFeed roundNumbers={roundNumbers} />
        </div>
      </div>
    </div>
  );
}
