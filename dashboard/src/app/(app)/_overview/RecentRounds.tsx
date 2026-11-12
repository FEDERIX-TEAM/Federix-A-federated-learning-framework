"use client";

import { History } from "lucide-react";
import { Badge } from "@/components/ui";
import type { RoundListEntry } from "@/gen/admin_pb";
import { RoundStatus } from "@/gen/common_pb";
import { duration, percent, relativeTime } from "@/lib/format";
import { ROUND_STATUS } from "@/lib/queries";
import { useNow } from "@/lib/useNow";
import { Empty, Panel, Skeleton } from "./Panel";
import styles from "./overview.module.css";

export function RecentRounds({ rounds }: { rounds?: RoundListEntry[] }) {
  const now = useNow(30_000);
  return (
    <Panel title="Recent rounds" subtitle="The latest rounds and how they ended" className={styles.span2} testId="recent-rounds">
      {!rounds ? (
        <Skeleton height={180} />
      ) : !rounds.length ? (
        <Empty icon={<History size={20} />} title="No rounds yet" text="Rounds you start appear here with their outcome." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.numCol}>Participants</th>
                <th scope="col" className={styles.numCol}>Accuracy</th>
                <th scope="col">Started</th>
                <th scope="col" className={styles.numCol}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => {
                const status = ROUND_STATUS[r.status];
                const done = r.status === RoundStatus.COMPLETE;
                return (
                  <tr key={r.roundId}>
                    <td className={styles.strong}>Round {r.roundNumber}</td>
                    <td>
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                    </td>
                    <td className={styles.numCol}>{r.participantCount}</td>
                    <td className={styles.numCol}>{done ? percent(r.accuracy) : "—"}</td>
                    <td className={styles.muted}>{relativeTime(r.startedAt, now)}</td>
                    <td className={styles.numCol}>{r.completedAt ? duration(r.startedAt, r.completedAt) : "running"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
