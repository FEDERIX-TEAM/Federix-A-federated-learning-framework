"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Database, Server, Cpu, Zap, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth";
import { Badge, Card } from "@/components/ui";
import { formatDuration, useHealth, type ServiceState } from "@/lib/health";
import { navFor, ROLE_LABEL } from "@/lib/nav";
import styles from "./welcome.module.css";

const ICONS: Record<ServiceState["key"], LucideIcon> = { api: Server, db: Database, redis: Zap, fl: Cpu };

function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Welcome() {
  const { profile } = useAuth();
  const health = useHealth();
  const [hello, setHello] = useState("Welcome");
  useEffect(() => setHello(greeting(new Date().getHours())), []);
  if (!profile) return null;
  const shortcuts = navFor(profile.role).filter((i) => i.href !== "/");

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{ROLE_LABEL[profile.role]}</p>
          <h2 className={styles.hello} data-testid="greeting">
            {hello}, {profile.name.split(" ")[0]}
          </h2>
          <p className={styles.lede}>Here&rsquo;s the state of your federation&rsquo;s infrastructure. Round and model insights land here next.</p>
        </div>
        {health.uptimeMs !== null ? (
          <Badge tone="accent" dot pulse>
            API up {formatDuration(health.uptimeMs)}
          </Badge>
        ) : null}
      </section>

      <section aria-label="Services" className={styles.services}>
        {health.services.map((s) => {
          const Icon = ICONS[s.key];
          return (
            <Card key={s.key} className={styles.service} data-tone={s.tone} data-testid={`service-${s.key}`}>
              <span className={styles.serviceIcon}>
                <Icon size={18} />
              </span>
              <span className={styles.serviceLabel}>{s.label}</span>
              <span className={styles.serviceValue}>
                <span className={styles.serviceDot} />
                {s.value}
              </span>
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="shortcuts" className={styles.shortcutsWrap}>
        <h3 id="shortcuts" className={styles.sectionTitle}>
          Jump to
        </h3>
        <div className={styles.shortcuts}>
          {shortcuts.map(({ href, label, description, icon: Icon }) => (
            <Link key={href} href={href} className={styles.shortcut}>
              <span className={styles.shortcutIcon}>
                <Icon size={18} />
              </span>
              <span className={styles.shortcutText}>
                <strong>{label}</strong>
                <span>{description}</span>
              </span>
              <ArrowUpRight size={16} className={styles.shortcutArrow} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
