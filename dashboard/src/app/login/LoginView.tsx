"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Gauge, Layers, Lock, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAuth, LoginRefused } from "@/components/auth";
import { useRuntime } from "@/components/runtime";
import { LogoMark } from "@/components/Logo";
import { Button, Dot } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useHealth } from "@/lib/health";
import { safeNext } from "@/lib/text";
import { FederationArt } from "./FederationArt";
import styles from "./login.module.css";

const FEATURES = [
  { icon: Gauge, title: "Utility-aware aggregation", text: "Every update is scored and weighted by what it adds." },
  { icon: Layers, title: "Compressed, resumable transfers", text: "Top-k updates over signed URLs that survive dropped links." },
  { icon: ShieldCheck, title: "Server-side validation", text: "Poisoned updates are caught before they reach the model." },
];

export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, login, endedUnexpectedly } = useAuth();
  const { apiUrl } = useRuntime();
  const health = useHealth();
  const next = safeNext(params.get("next"));
  const expired = params.get("reason") === "expired" || endedUnexpectedly;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof LoginRefused ? err.message : describeError(err));
      setSubmitting(false);
    }
  }

  const host = apiUrl.replace(/^https?:\/\//, "");
  const serverTone = health.overall === "healthy" ? "ok" : health.overall === "degraded" ? "warn" : health.overall === "offline" ? "bad" : "neutral";
  const serverText = { checking: "checking…", healthy: "online", degraded: "degraded", offline: "unreachable" }[health.overall];

  return (
    <main className={styles.page}>
      <section className={styles.art} aria-hidden="true">
        <div className={styles.artGrid} />
        <div className={styles.artTop}>
          <LogoMark size={36} />
          <span className={styles.artBrand}>Federix</span>
        </div>
        <div className={styles.artStage}>
          <FederationArt />
        </div>
        <div className={styles.artCopy}>
          <p className={styles.eyebrow}>Federated learning control plane</p>
          <h1 className={styles.headline}>
            Train together.
            <br />
            <span className={styles.headlineAccent}>Share nothing.</span>
          </h1>
          <p className={styles.lede}>Coordinate rounds, watch the global model converge and keep every client&rsquo;s data on the client.</p>
          <ul className={styles.features}>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className={styles.featureIcon}>
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.formWrap}>
          <div className={styles.mobileBrand}>
            <LogoMark size={40} />
            <span>Federix</span>
          </div>
          <h2 className={styles.title}>Welcome back</h2>
          <p className={styles.subtitle}>Sign in with your Federix admin account.</p>

          {expired && !error ? (
            <div className={styles.notice} data-tone="warn" role="status" data-testid="login-notice">
              <TriangleAlert size={16} />
              <span>Your session ended. Sign in again to continue.</span>
            </div>
          ) : null}
          {error ? (
            <div className={styles.notice} data-tone="bad" role="alert" data-testid="login-error">
              <TriangleAlert size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <form className={styles.form} onSubmit={onSubmit} noValidate>
            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <span className={styles.inputWrap}>
                <Mail size={16} className={styles.inputIcon} />
                <input
                  ref={emailRef}
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                  aria-invalid={Boolean(error) || undefined}
                />
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Password</span>
              <span className={styles.inputWrap}>
                <Lock size={16} className={styles.inputIcon} />
                <input
                  name="password"
                  type={reveal ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                  aria-invalid={Boolean(error) || undefined}
                />
                <button type="button" className={styles.reveal} onClick={() => setReveal((v) => !v)} aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal}>
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <Button type="submit" variant="primary" block loading={submitting || status === "loading"} disabled={status === "signed-in"}>
              {submitting ? "Signing in…" : "Sign in"}
              {submitting ? null : <ArrowRight size={16} />}
            </Button>
          </form>

          <div className={styles.server} data-tone={serverTone} title={apiUrl}>
            <Dot pulse={health.overall === "healthy"} />
            <span>
              Server <span className="mono">{host}</span> · {serverText}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
