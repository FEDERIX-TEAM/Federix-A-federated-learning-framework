"use client";

import { useState } from "react";
import Link from "next/link";
import { Code, ConnectError } from "@connectrpc/connect";
import { Check, ChevronLeft, CircleSlash, Square, TriangleAlert, X } from "lucide-react";
import { useAuth } from "@/components/auth";
import { Badge, Button } from "@/components/ui";
import { RoundStatus } from "@/gen/common_pb";
import { bytes, compact, countdown, duration, percent, relativeTime } from "@/lib/format";
import { can } from "@/lib/nav";
import { ROUND_STATUS } from "@/lib/queries";
import { useRoundDetail, useRoundUpdates } from "@/lib/rounds";
import { isRunning, stageOf, tierOf, timelineOf } from "@/lib/roundView";
import { useNow } from "@/lib/useNow";
import { StopRoundDialog } from "./StopRoundDialog";
import { UtilityChart } from "./UtilityChart";
import styles from "./detail.module.css";

const PARTICIPANT_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  joined: { label: "Joined", tone: "ok" },
  left: { label: "Left", tone: "warn" },
  dropped: { label: "Dropped", tone: "bad" },
};

export function RoundDetailView({ roundId }: { roundId: string }) {
  const { profile } = useAuth();
  const detail = useRoundDetail(roundId);
  const updates = useRoundUpdates(roundId);
  const now = useNow(1000);
  const [stopping, setStopping] = useState(false);
  if (!profile) return null;

  if (detail.isError) {
    const missing = ConnectError.from(detail.error).code === Code.NotFound;
    return (
      <div className={styles.missing} role="alert" data-testid="round-missing">
        <CircleSlash size={26} />
        <h2>{missing ? "This round doesn't exist" : "The round couldn't be loaded"}</h2>
        <p>{missing ? "It may have been typed wrong, or belongs to another federation." : detail.error.message}</p>
        <Link href="/rounds">Back to rounds</Link>
      </div>
    );
  }

  const d = detail.data;
  const list = updates.data ?? [];
  const status = d ? ROUND_STATUS[d.status] : null;
  const running = d ? isRunning(d.status) : false;
  const usable = list.filter((u) => u.stage === "accepted" || u.stage === "compressed").length;
  const totalBytes = list.reduce((sum, u) => sum + Number(u.bytes), 0);
  const joined = d?.participants.filter((p) => p.status === "joined").length ?? 0;
  const steps = d ? timelineOf(d) : [];

  return (
    <div className={styles.page}>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link href="/rounds">
          <ChevronLeft size={15} />
          Rounds
        </Link>
      </nav>

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title} data-testid="round-title">
            {d ? `Round ${d.roundNumber}` : "Round"}
          </h2>
          {status ? (
            <Badge tone={status.tone} dot pulse={running} data-testid="round-status">
              {status.label}
            </Badge>
          ) : null}
          {d?.notes ? <p className={styles.notes}>{d.notes}</p> : null}
        </div>
        {d && running && can(profile.role, "stopRound") ? (
          <Button variant="secondary" onClick={() => setStopping(true)} data-testid="stop-round">
            <Square size={14} />
            Stop round
          </Button>
        ) : null}
      </header>

      {d?.endReason ? (
        <div className={styles.alert} data-tone={d.status === RoundStatus.FAILED ? "bad" : "warn"} role="status" data-testid="end-reason">
          <TriangleAlert size={18} />
          <div>
            <strong>{d.status === RoundStatus.FAILED ? "This round failed" : "This round was stopped"}</strong>
            <span>{d.endReason}</span>
          </div>
        </div>
      ) : null}

      <section className={styles.tiles} aria-label="Round summary">
        <div className={styles.tile} data-testid="tile-participants">
          <span className={styles.tileLabel}>Participants</span>
          <span className={styles.tileValue}>
            {d ? joined : "—"}
            <small>/{d?.maxClients ?? "—"}</small>
          </span>
          <span className={styles.tileSub}>{d ? `at least ${d.minClients} needed` : ""}</span>
        </div>
        <div className={styles.tile} data-testid="tile-updates">
          <span className={styles.tileLabel}>Usable updates</span>
          <span className={styles.tileValue}>
            {updates.data ? usable : "—"}
            <small>/{updates.data ? list.length : "—"}</small>
          </span>
          <span className={styles.tileSub}>{updates.data ? `${list.filter((u) => u.stage === "rejected").length} rejected` : ""}</span>
        </div>
        <div className={styles.tile} data-testid="tile-result">
          {d && d.status === RoundStatus.COMPLETE ? (
            <>
              <span className={styles.tileLabel}>Model accuracy</span>
              <span className={styles.tileValue}>{percent(d.globalAccuracy)}</span>
              <span className={styles.tileSub}>
                loss {d.globalLoss.toFixed(3)} · model v{d.modelVersionAfter}
              </span>
            </>
          ) : d && d.status === RoundStatus.ACTIVE && !d.readyAt ? (
            <>
              <span className={styles.tileLabel}>Deadline</span>
              <span className={styles.tileValue + " num"}>{countdown(d.deadline, now)}</span>
              <span className={styles.tileSub}>{new Date(d.deadline).toLocaleTimeString()}</span>
            </>
          ) : (
            <>
              <span className={styles.tileLabel}>Duration</span>
              <span className={styles.tileValue}>{d ? duration(d.startedAt, d.completedAt || new Date(now).toISOString()) : "—"}</span>
              <span className={styles.tileSub}>{d ? `started ${relativeTime(d.startedAt, now)}` : ""}</span>
            </>
          )}
        </div>
        <div className={styles.tile} data-testid="tile-data">
          <span className={styles.tileLabel}>Data received</span>
          <span className={styles.tileValue}>{updates.data ? bytes(totalBytes) : "—"}</span>
          <span className={styles.tileSub}>{updates.data ? `${compact(list.reduce((s, u) => s + u.dataSize, 0))} training samples` : ""}</span>
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel} aria-label="Timeline">
          <h3 className={styles.panelTitle}>Timeline</h3>
          <ol className={styles.timeline} data-testid="timeline">
            {steps.map((s, i) => {
              const next = steps[i + 1];
              return (
                <li key={s.key} data-state={s.state}>
                  <span className={styles.timelineDot}>
                    {s.state === "done" ? <Check size={12} strokeWidth={3} /> : s.state === "failed" ? <X size={12} strokeWidth={3} /> : null}
                  </span>
                  <div className={styles.timelineText}>
                    <strong>{s.label}</strong>
                    <span>{s.at ? new Date(s.at).toLocaleString() : s.state === "current" ? "in progress" : s.state === "skipped" ? "skipped" : "not yet"}</span>
                    {s.note ? <em>{s.note}</em> : null}
                  </div>
                  {s.at && next?.at ? <span className={styles.timelineGap}>{duration(s.at, next.at)}</span> : null}
                </li>
              );
            })}
          </ol>
        </section>

        <section className={styles.panel} aria-label="Configuration">
          <h3 className={styles.panelTitle}>Configuration</h3>
          <p className={styles.panelSub}>Frozen when the round started</p>
          {d?.config ? (
            <dl className={styles.config}>
              <div>
                <dt>FedProx μ</dt>
                <dd>{d.config.mu}</dd>
              </div>
              <div>
                <dt>Local epochs</dt>
                <dd>{d.config.localEpochs}</dd>
              </div>
              <div>
                <dt>Batch size</dt>
                <dd>{d.config.batchSize}</dd>
              </div>
              <div>
                <dt>Utility tiers</dt>
                <dd>
                  {d.config.utilityThresholdLow} / {d.config.utilityThresholdHigh}
                </dd>
              </div>
              <div>
                <dt>Starting model</dt>
                <dd>{d.modelVersionBefore ? `v${d.modelVersionBefore}` : "none"}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      </div>

      <section className={styles.panel} aria-label="Updates">
        <div className={styles.panelHead}>
          <div>
            <h3 className={styles.panelTitle}>Updates</h3>
            <p className={styles.panelSub}>Utility decides each update&rsquo;s compression tier and its weight in aggregation</p>
          </div>
        </div>
        {!updates.data ? (
          <span className={styles.skeleton} />
        ) : !list.length ? (
          <p className={styles.none}>{running ? "No updates yet. They appear here as clients finish training." : "No client sent an update in this round."}</p>
        ) : (
          <>
            {d?.config ? <UtilityChart updates={list} low={d.config.utilityThresholdLow} high={d.config.utilityThresholdHigh} /> : null}
            <div className={styles.tableWrap}>
              <table className={styles.table} data-testid="updates-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Status</th>
                    <th scope="col" className={styles.num}>Utility</th>
                    <th scope="col">Tier</th>
                    <th scope="col" className={styles.num}>Size</th>
                    <th scope="col" className={styles.num}>Samples</th>
                    <th scope="col" className={styles.num}>Local loss</th>
                    <th scope="col">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => {
                    const st = stageOf(u.stage);
                    return (
                      <tr key={u.updateId} data-update={u.updateId}>
                        <td>
                          <div className={styles.client}>
                            <strong>{u.clientName || "Unnamed client"}</strong>
                            <span className="mono">{u.clientId.slice(0, 8)}</span>
                          </div>
                        </td>
                        <td>
                          <div className={styles.statusCell}>
                            <Badge tone={st.tone} dot>
                              {st.label}
                            </Badge>
                            {u.reason ? <span className={styles.reason}>{u.reason}</span> : null}
                          </div>
                        </td>
                        <td className={styles.num}>{u.utilityScore ? u.utilityScore.toFixed(3) : "—"}</td>
                        <td>{tierOf(u.compressionLevel, u.compressionRatio)}</td>
                        <td className={styles.num}>{Number(u.bytes) ? bytes(Number(u.bytes)) : "—"}</td>
                        <td className={styles.num}>{compact(u.dataSize)}</td>
                        <td className={styles.num}>
                          {u.localLossBefore.toFixed(3)} → {u.localLossAfter.toFixed(3)}
                        </td>
                        <td className={styles.muted}>{u.submittedAt ? relativeTime(u.submittedAt, now) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={styles.panel} aria-label="Participants">
        <h3 className={styles.panelTitle}>Participants</h3>
        {d && !d.participants.length ? (
          <p className={styles.none}>No client has joined this round.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="participants-table">
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={styles.num}>Declared samples</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Left</th>
                </tr>
              </thead>
              <tbody>
                {(d?.participants ?? []).map((p) => {
                  const ps = PARTICIPANT_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
                  return (
                    <tr key={p.clientId}>
                      <td>
                        <div className={styles.client}>
                          <strong>{p.clientName || "Unnamed client"}</strong>
                          <span className="mono">{p.clientId.slice(0, 8)}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={ps.tone} dot>
                          {ps.label}
                        </Badge>
                      </td>
                      <td className={styles.num}>{compact(p.localDataSize)}</td>
                      <td className={styles.muted}>{relativeTime(p.joinedAt, now)}</td>
                      <td className={styles.muted}>{p.leftAt ? `${relativeTime(p.leftAt, now)}${p.leaveReason ? ` · ${p.leaveReason}` : ""}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d ? (
        <StopRoundDialog open={stopping} onClose={() => setStopping(false)} roundId={d.roundId} roundNumber={d.roundNumber} modelVersion={d.modelVersionBefore} />
      ) : null}
    </div>
  );
}
