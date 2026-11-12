"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/components/auth";
import { useRuntime } from "@/components/runtime";
import { Dot } from "@/components/ui";
import { formatDuration, useHealth } from "@/lib/health";
import { usePopover } from "./usePopover";
import styles from "./shell.module.css";

const SUMMARY = {
  checking: { text: "Checking…", tone: "neutral" },
  healthy: { text: "All systems normal", tone: "ok" },
  degraded: { text: "Degraded", tone: "warn" },
  offline: { text: "Server unreachable", tone: "bad" },
} as const;

export function ConnectionStatus() {
  const api = useApi();
  const { apiUrl, healthPollMs } = useRuntime();
  const health = useHealth();
  const version = useQuery({ queryKey: ["system", "version"], queryFn: () => api.system.getVersion({}), staleTime: 300_000 });
  const pop = usePopover();
  const summary = SUMMARY[health.overall];

  return (
    <div className={styles.popWrap} ref={pop.ref}>
      <button
        type="button"
        className={styles.statusPill}
        data-tone={summary.tone}
        onClick={pop.toggle}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        data-testid="connection-status"
        data-state={health.overall}
      >
        <Dot pulse={health.overall === "healthy"} />
        <span className={styles.statusText}>{summary.text}</span>
      </button>
      {pop.open ? (
        <div className={styles.popover} role="dialog" aria-label="Service status">
          <div className={styles.popHead}>
            <span>Service status</span>
            <span className={styles.popMeta}>checked every {Math.round(healthPollMs / 1000)}s</span>
          </div>
          <ul className={styles.serviceList}>
            {health.services.map((s) => (
              <li key={s.key} data-tone={s.tone}>
                <Dot />
                <span>{s.label}</span>
                <span className={styles.serviceValue}>{s.value}</span>
              </li>
            ))}
          </ul>
          <dl className={styles.facts}>
            <div>
              <dt>Endpoint</dt>
              <dd className="mono">{apiUrl.replace(/^https?:\/\//, "")}</dd>
            </div>
            <div>
              <dt>API version</dt>
              <dd className="mono">{version.data ? `${version.data.apiVersion} · ${version.data.environment}` : "—"}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd className="num">{health.uptimeMs !== null ? formatDuration(health.uptimeMs) : "—"}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

