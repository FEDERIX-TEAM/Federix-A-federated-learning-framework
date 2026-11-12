import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  iconOnly?: boolean;
  loading?: boolean;
}

export function Button({ variant = "secondary", block, iconOnly, loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], block && styles.block, iconOnly && styles.icon, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className={styles.spinner} role={label ? "status" : undefined} aria-label={label} />;
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info" | "violet";

export function Badge({ tone = "neutral", dot, pulse, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={tone} {...rest}>
      {dot ? <span className={styles.dot} data-pulse={pulse ? "true" : undefined} /> : null}
      {children}
    </span>
  );
}

export function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={styles.dot} data-pulse={pulse ? "true" : undefined} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.card, className].filter(Boolean).join(" ")} {...rest} />;
}
