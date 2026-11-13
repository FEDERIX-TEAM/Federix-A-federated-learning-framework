"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronRight, History, Play, Square } from "lucide-react";
import { useAuth } from "@/components/auth";
import { Badge, Button } from "@/components/ui";
import { Chips } from "@/components/ui/Field";
import { RoundStatus } from "@/gen/common_pb";
import { countdown, duration, percent, relativeTime } from "@/lib/format";
import { can } from "@/lib/nav";
import { ROUND_STATUS, useOverview } from "@/lib/queries";
import { useRoundsList } from "@/lib/rounds";
import { isStatusFilter, STATUS_FILTERS } from "@/lib/roundView";
import { useNow } from "@/lib/useNow";
import { StartRoundDialog } from "./StartRoundDialog";
import { StopRoundDialog } from "./StopRoundDialog";
import styles from "./rounds.module.css";

export function RoundsView() {
  const { profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("status");
  const status = isStatusFilter(raw) ? (raw ?? "") : "";
  const list = useRoundsList(status);
  const overview = useOverview();
  const now = useNow(1000);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  if (!profile) return null;

  const canStart = can(profile.role, "startRound");
  const canStop = can(profile.role, "stopRound");
  const canOpen = can(profile.role, "roundDetail");
  const running = overview.data?.currentRoundId ? overview.data : null;
  const rows = list.data?.pages.flat() ?? [];

  function setStatus(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set("status", value);
    else next.delete("status");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className={styles.page}>
      {running ? (
        <section className={styles.running} data-testid="running-round" aria-label="Running round">
          <span className={styles.runningPulse} aria-hidden="true" />
          <div className={styles.runningText}>
            <strong>
              Round {running.currentRoundNumber} is {running.currentRoundStatus === "aggregating" ? "being aggregated" : "collecting updates"}
            </strong>
            <span>
              {running.currentRoundParticipants}/{running.currentRoundMaxClients} participants · {running.currentRoundUpdates} updates
              {running.currentRoundStatus === "active" && running.currentRoundDeadline ? <> · deadline in <span className="num">{countdown(running.currentRoundDeadline, now)}</span></> : null}
            </span>
          </div>
          <div className={styles.runningActions}>
            {canStop ? (
              <Button variant="ghost" onClick={() => setStopping(true)} data-testid="stop-running">
                <Square size={14} />
                Stop
              </Button>
            ) : null}
            {canOpen ? (
              <Link href={`/rounds/${running.currentRoundId}`} className={styles.runningLink}>
                View round
                <ArrowRight size={15} />
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className={styles.toolbar}>
        <Chips label="Filter by status" options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))} value={status} onChange={setStatus} />
        {canStart ? (
          <Button variant="primary" onClick={() => setStarting(true)} disabled={Boolean(running)} title={running ? `Round ${running.currentRoundNumber} is still running` : undefined} data-testid="start-round">
            <Play size={15} />
            Start round
          </Button>
        ) : null}
      </div>

      <section className={styles.card} aria-label="Rounds">
        {list.isPending ? (
          <div className={styles.loading}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : list.isError ? (
          <div className={styles.empty} role="alert">
            <strong>Rounds couldn&rsquo;t be loaded</strong>
            <p>{list.error.message}</p>
            <Button onClick={() => list.refetch()}>Try again</Button>
          </div>
        ) : !rows.length ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <History size={20} />
            </span>
            <strong>{status ? "No rounds with this status" : "No rounds yet"}</strong>
            <p>{status ? "Try another filter." : canStart ? "Start the first round when clients are online." : "Rounds appear here once an admin starts one."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="rounds-table">
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={styles.num}>Participants</th>
                  <th scope="col" className={styles.num}>Updates</th>
                  <th scope="col" className={styles.num}>Accuracy</th>
                  <th scope="col" className={styles.num}>Loss</th>
                  <th scope="col">Model</th>
                  <th scope="col">Started</th>
                  <th scope="col" className={styles.num}>Duration</th>
                  {canOpen ? <th scope="col"><span className="sr-only">Open</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = ROUND_STATUS[r.status];
                  const done = r.status === RoundStatus.COMPLETE;
                  return (
                    <tr key={r.roundId} data-clickable={canOpen || undefined} onClick={canOpen ? () => router.push(`/rounds/${r.roundId}`) : undefined}>
                      <td>
                        <div className={styles.roundCell}>
                          {canOpen ? (
                            <Link href={`/rounds/${r.roundId}`} className={styles.roundLink} onClick={(e) => e.stopPropagation()}>
                              Round {r.roundNumber}
                            </Link>
                          ) : (
                            <span className={styles.roundLink}>Round {r.roundNumber}</span>
                          )}
                          {r.notes ? <span className={styles.notes} title={r.notes}>{r.notes}</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className={styles.statusCell}>
                          <Badge tone={s.tone} dot pulse={r.status === RoundStatus.ACTIVE || r.status === RoundStatus.AGGREGATING}>
                            {s.label}
                          </Badge>
                          {r.endReason ? <span className={styles.reason} title={r.endReason}>{r.endReason}</span> : null}
                        </div>
                      </td>
                      <td className={styles.num}>
                        {r.participantCount}
                        <span className={styles.of}>/{r.maxClients || "—"}</span>
                      </td>
                      <td className={styles.num}>{r.usableUpdates}</td>
                      <td className={styles.num}>{done ? percent(r.accuracy) : "—"}</td>
                      <td className={styles.num}>{done && r.globalLoss !== undefined ? r.globalLoss.toFixed(3) : "—"}</td>
                      <td>{r.modelVersionAfter ? <span className={styles.model}>v{r.modelVersionAfter}</span> : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.muted} title={new Date(r.startedAt).toLocaleString()}>
                        {relativeTime(r.startedAt, now)}
                      </td>
                      <td className={styles.num}>{r.completedAt ? duration(r.startedAt, r.completedAt) : <span className={styles.muted}>running</span>}</td>
                      {canOpen ? (
                        <td className={styles.chevron}>
                          <ChevronRight size={16} />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage ? (
          <div className={styles.more}>
            <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
              Load more rounds
            </Button>
          </div>
        ) : null}
      </section>

      <StartRoundDialog open={starting} onClose={() => setStarting(false)} />
      {running ? (
        <StopRoundDialog
          open={stopping}
          onClose={() => setStopping(false)}
          roundId={running.currentRoundId}
          roundNumber={running.currentRoundNumber}
          modelVersion={running.latestModelVersion}
        />
      ) : null}
    </div>
  );
}
