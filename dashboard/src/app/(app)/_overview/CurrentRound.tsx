"use client";

import Link from "next/link";
import { Check, CirclePause, Timer } from "lucide-react";
import { Badge } from "@/components/ui";
import type { OverviewResponse } from "@/gen/admin_pb";
import type { Role } from "@/lib/auth/session";
import { countdown, relativeTime } from "@/lib/format";
import { stepOf } from "@/lib/overview";
import { useNow } from "@/lib/useNow";
import { Empty, Panel, Skeleton } from "./Panel";
import styles from "./overview.module.css";

const STEPS = ["Collecting", "Ready", "Aggregating", "Complete"] as const;
const CAN_START: readonly Role[] = ["super_admin", "admin", "fl_engineer"];

function Meter({ label, value, max, testId }: { label: string; value: number; max: number; testId: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={styles.meter} data-testid={testId}>
      <div className={styles.meterHead}>
        <span>{label}</span>
        <span className="num">
          <strong>{value}</strong> / {max}
        </span>
      </div>
      <div className={styles.meterTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CurrentRound({ overview, role }: { overview?: OverviewResponse; role: Role }) {
  const now = useNow(1000);
  if (!overview) {
    return (
      <Panel title="Current round">
        <Skeleton height={200} />
      </Panel>
    );
  }
  if (!overview.currentRoundId) {
    return (
      <Panel title="Current round" testId="current-round">
        <Empty icon={<CirclePause size={20} />} title="No round running" text="Start a round when enough clients are online. Its progress shows up here live.">
          {CAN_START.includes(role) ? (
            <Link href="/rounds" className={styles.emptyLink}>
              Go to rounds
            </Link>
          ) : null}
        </Empty>
      </Panel>
    );
  }
  const step = stepOf(overview);
  const deadline = overview.currentRoundDeadline;
  const overdue = deadline && Date.parse(deadline) <= now;
  return (
    <Panel
      title={`Round ${overview.currentRoundNumber}`}
      subtitle={`Started ${relativeTime(overview.currentRoundStartedAt, now)}`}
      testId="current-round"
      actions={<Badge tone={step === 2 ? "violet" : step === 1 ? "info" : "accent"} dot pulse>{STEPS[step]}</Badge>}
    >
      <ol className={styles.stepper} aria-label="Round progress">
        {STEPS.map((s, i) => (
          <li key={s} data-state={i < step ? "done" : i === step ? "current" : "todo"} aria-current={i === step ? "step" : undefined}>
            <span className={styles.stepDot}>{i < step ? <Check size={12} strokeWidth={3} /> : null}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className={styles.meters}>
        <Meter testId="meter-participants" label="Participants" value={overview.currentRoundParticipants} max={overview.currentRoundMaxClients} />
        <Meter testId="meter-updates" label="Updates received" value={overview.currentRoundUpdates} max={Math.max(overview.currentRoundParticipants, overview.currentRoundUpdates)} />
      </div>
      <div className={styles.deadline} data-overdue={overdue || undefined}>
        <Timer size={16} />
        {step >= 1 ? (
          <span>Ready {relativeTime(overview.currentRoundReadyAt, now)} · waiting for the FL server</span>
        ) : deadline ? (
          <span>
            {overdue ? "Deadline passed" : <>Deadline in <strong className="num">{countdown(deadline, now)}</strong></>}
          </span>
        ) : (
          <span>No deadline</span>
        )}
      </div>
    </Panel>
  );
}
