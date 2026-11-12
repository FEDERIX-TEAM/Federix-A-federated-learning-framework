import type { ReactNode } from "react";
import styles from "./overview.module.css";

export function Panel({ title, subtitle, actions, children, className, testId }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(" ")} aria-label={title} data-testid={testId}>
      <header className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h3 className={styles.panelTitle}>{title}</h3>
          {subtitle ? <p className={styles.panelSub}>{subtitle}</p> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <span className={styles.skeleton} style={{ height, width }} aria-hidden="true" />;
}
