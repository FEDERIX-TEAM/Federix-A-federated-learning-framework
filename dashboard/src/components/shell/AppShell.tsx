"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight, Menu, Moon, Search, ShieldOff, Sun, X } from "lucide-react";
import { useAuth } from "@/components/auth";
import { useTheme } from "@/components/theme";
import { LogoMark } from "@/components/Logo";
import { Button, Kbd } from "@/components/ui";
import { canAccess, GROUPS, itemFor, navFor, restrictionFor, ROLE_LABEL } from "@/lib/nav";
import { LiveEventsProvider } from "@/components/live";
import { ToastProvider } from "@/components/toast";
import { CommandPalette } from "./CommandPalette";
import { ConnectionStatus } from "./ConnectionStatus";
import { UserMenu } from "./UserMenu";
import styles from "./shell.module.css";

const COLLAPSE_KEY = "federix.sidebar";

function Splash() {
  return (
    <div className={styles.splash} role="status" aria-label="Loading Federix">
      <div className={styles.splashMark}>
        <LogoMark size={48} />
      </div>
    </div>
  );
}

export function AppGate({ children }: { children: ReactNode }) {
  const { status, endedUnexpectedly } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "signed-out") return;
    const params = new URLSearchParams();
    if (pathname !== "/") params.set("next", pathname);
    if (endedUnexpectedly) params.set("reason", "expired");
    const query = params.toString();
    router.replace(query ? `/login?${query}` : "/login");
  }, [status, endedUnexpectedly, pathname, router]);

  if (status !== "signed-in") return <Splash />;
  return (
    <LiveEventsProvider>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </LiveEventsProvider>
  );
}

function Forbidden({ label }: { label: string }) {
  const { profile } = useAuth();
  return (
    <div className={styles.forbidden} data-testid="forbidden">
      <span className={styles.forbiddenIcon}>
        <ShieldOff size={26} />
      </span>
      <h1>You don&rsquo;t have access to {label}</h1>
      <p>
        Your role{profile ? <> (<strong>{ROLE_LABEL[profile.role]}</strong>)</> : null} can&rsquo;t open this page. Ask a super admin if you need it.
      </p>
      <Link href="/" className={styles.forbiddenLink}>
        Back to overview
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, api } = useAuth();
  const { resolved, toggle } = useTheme();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [mac, setMac] = useState(false);
  const version = useQuery({ queryKey: ["system", "version"], queryFn: () => api.system.getVersion({}), staleTime: 300_000 });

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "collapsed");
    } catch {}
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, v ? "expanded" : "collapsed");
      } catch {}
      return !v;
    });
  }, []);

  if (!profile) return null;
  const items = navFor(profile.role);
  const current = itemFor(pathname);
  const allowed = canAccess(profile.role, pathname);
  const environment = version.data?.environment;

  return (
    <div className={styles.shell} data-collapsed={collapsed || undefined} data-drawer={drawer || undefined}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <aside className={styles.sidebar} aria-label="Primary">
        <div className={styles.brand}>
          <Link href="/" className={styles.brandLink} aria-label="Federix overview">
            <LogoMark size={32} />
            <span className={styles.brandText}>
              <span className={styles.brandName}>Federix</span>
              {environment ? <span className={styles.brandEnv}>{environment}</span> : null}
            </span>
          </Link>
          <button type="button" className={styles.drawerClose} onClick={() => setDrawer(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <nav className={styles.nav} data-testid="sidebar-nav">
          {GROUPS.map((group) => {
            const entries = items.filter((i) => i.group === group);
            if (!entries.length) return null;
            return (
              <div key={group} className={styles.navGroup}>
                <div className={styles.navLabel}>{group}</div>
                <ul>
                  {entries.map(({ href, label, icon: Icon }) => {
                    const active = current?.href === href;
                    return (
                      <li key={href}>
                        <Link href={href} className={styles.navItem} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}>
                          <Icon size={18} className={styles.navIcon} />
                          <span className={styles.navText}>{label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className={styles.sidebarFoot}>
          <UserMenu />
          <button type="button" className={styles.collapse} onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}>
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
      </aside>

      <div className={styles.scrim} onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button type="button" className={styles.menuButton} onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className={styles.heading}>
            <h1 className={styles.pageTitle}>{current?.label ?? "Federix"}</h1>
            {current ? <p className={styles.pageDesc}>{current.description}</p> : null}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.searchButton} onClick={() => setPalette(true)} aria-label="Open command palette" data-testid="open-palette">
              <Search size={15} />
              <span className={styles.searchText}>Search or jump to…</span>
              <span className={styles.searchKeys}>
                <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <ConnectionStatus />
            <Button variant="ghost" iconOnly onClick={toggle} aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"} data-testid="theme-toggle">
              {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <span className={styles.topbarUser}>
              <UserMenu compact />
            </span>
          </div>
        </header>
        <main id="main" className={styles.content} tabIndex={-1}>
          {allowed ? children : <Forbidden label={restrictionFor(pathname)?.label ?? current?.label ?? "this page"} />}
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
