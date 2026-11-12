"use client";

import { Cpu, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui";
import type { FlServerStatusResponse } from "@/gen/admin_pb";
import { relativeTime } from "@/lib/format";
import { FL_STATE } from "@/lib/queries";
import { useNow } from "@/lib/useNow";
import { Empty, Panel, Skeleton } from "./Panel";
import styles from "./overview.module.css";

export function FlServerCard({ status }: { status?: FlServerStatusResponse }) {
  const now = useNow(15_000);
  if (!status) {
    return (
      <Panel title="FL server">
        <Skeleton height={96} />
      </Panel>
    );
  }
  const state = FL_STATE[status.state];
  const reported = Boolean(status.lastReportAt);
  return (
    <Panel
      title="FL server"
      testId="fl-server"
      actions={
        <Badge tone={status.online ? state.tone : "warn"} dot pulse={status.online}>
          {status.online ? state.label : reported ? "Offline" : "Not reporting"}
        </Badge>
      }
    >
      {!reported ? (
        <Empty icon={<Cpu size={20} />} title="The FL server hasn't reported yet" text="Start the brain with `federix-server`; it reports here as soon as it connects." />
      ) : (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>Worker</dt>
              <dd className="mono">{status.workerId}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd className="mono">{status.version || "—"}</dd>
            </div>
            <div>
              <dt>Last report</dt>
              <dd>{relativeTime(status.lastReportAt, now)}</dd>
            </div>
          </dl>
          {status.message ? <p className={styles.flMessage}>{status.message}</p> : null}
          {status.lastError ? (
            <p className={styles.flError} role="status">
              <TriangleAlert size={14} />
              <span>{status.lastError}</span>
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
