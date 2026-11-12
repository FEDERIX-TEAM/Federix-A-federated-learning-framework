"use client";

import { useMemo } from "react";
import { Activity, Boxes, Cpu, Radio, Settings2, ShieldAlert, Upload, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import { useLiveEvents } from "@/components/live";
import { describeEvent, type EventKind } from "@/lib/events";
import { relativeTime } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { Empty, Panel } from "./Panel";
import styles from "./overview.module.css";

const ICON: Record<EventKind, LucideIcon> = { round: Activity, client: Users, update: Upload, model: Boxes, server: Cpu, config: Settings2, system: ShieldAlert };

export function ActivityFeed({ roundNumbers }: { roundNumbers: Map<string, number> }) {
  const { state, events } = useLiveEvents();
  const now = useNow(15_000);
  const items = useMemo(() => events.map((e) => ({ e, d: describeEvent(e, roundNumbers) })), [events, roundNumbers]);
  const badge = state === "live" ? { tone: "ok" as const, text: "Live" } : state === "connecting" ? { tone: "neutral" as const, text: "Connecting" } : { tone: "warn" as const, text: "Reconnecting" };
  return (
    <Panel
      title="Live activity"
      subtitle="Events as they happen across the federation"
      testId="activity"
      actions={
        <Badge tone={badge.tone} dot pulse={state === "live"} data-testid="stream-state" data-state={state}>
          {badge.text}
        </Badge>
      }
    >
      {!items.length ? (
        <Empty icon={<Radio size={20} />} title="Waiting for activity" text="Joins, updates and finished rounds appear here the moment they happen." />
      ) : (
        <ol className={styles.feed} aria-live="polite" aria-relevant="additions">
          {items.map(({ e, d }) => {
            const Icon = ICON[d.kind];
            return (
              <li key={e.id} className={styles.feedItem} data-tone={d.tone} data-type={e.type}>
                <span className={styles.feedIcon}>
                  <Icon size={14} />
                </span>
                <span className={styles.feedText}>
                  <span className={styles.feedTitle}>{d.title}</span>
                  {d.detail ? <span className={styles.feedDetail}>{d.detail}</span> : null}
                </span>
                <time className={styles.feedTime} dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                  {relativeTime(e.at, now)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
