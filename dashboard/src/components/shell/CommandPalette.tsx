"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, LogOut, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth";
import { useTheme } from "@/components/theme";
import { Kbd } from "@/components/ui";
import { navFor } from "@/lib/nav";
import { matches } from "@/lib/text";
import styles from "./palette.module.css";

interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { profile, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    if (!profile) return [];
    const pages: Command[] = navFor(profile.role).map((item) => ({
      id: `page:${item.href}`,
      label: item.label,
      hint: item.description,
      group: "Go to",
      icon: item.icon,
      keywords: `${item.label} ${item.keywords} ${item.description}`,
      run: () => router.push(item.href),
    }));
    return [
      ...pages,
      {
        id: "theme",
        label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
        hint: "Appearance",
        group: "Actions",
        icon: resolved === "dark" ? Sun : Moon,
        keywords: "theme dark light appearance mode",
        run: toggle,
      },
      { id: "logout", label: "Sign out", hint: profile.email, group: "Actions", icon: LogOut, keywords: "logout sign out exit", run: () => void logout() },
    ];
  }, [profile, resolved, toggle, logout, router]);

  const results = useMemo(() => commands.filter((c) => matches(c.keywords, query)), [commands, query]);

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
    } else {
      returnFocus.current?.focus?.();
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function choose(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  }

  let lastGroup = "";
  return (
    <div className={styles.scrim} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className={styles.searchRow}>
          <Search size={18} className={styles.searchIcon} />
          <input
            ref={inputRef}
            autoFocus
            className={styles.input}
            placeholder="Search pages and actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
            aria-label="Search pages and actions"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul ref={listRef} id="palette-results" className={styles.list} role="listbox" aria-label="Results">
          {results.length === 0 ? <li className={styles.empty}>No matches for &ldquo;{query}&rdquo;</li> : null}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <li key={c.id} role="presentation">
                {header ? <div className={styles.group}>{header}</div> : null}
                <div
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className={styles.item}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(c)}
                >
                  <span className={styles.itemIcon}>
                    <Icon size={16} />
                  </span>
                  <span className={styles.itemText}>
                    <span className={styles.itemLabel}>{c.label}</span>
                    <span className={styles.itemHint}>{c.hint}</span>
                  </span>
                  {i === active ? <CornerDownLeft size={14} className={styles.enter} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <div className={styles.footer}>
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
