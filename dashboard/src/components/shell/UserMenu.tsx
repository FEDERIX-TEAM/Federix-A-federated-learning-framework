"use client";

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/components/auth";
import { useTheme, type ThemeChoice } from "@/components/theme";
import { ROLE_LABEL } from "@/lib/nav";
import { initials } from "@/lib/text";
import { usePopover } from "./usePopover";
import styles from "./shell.module.css";

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function UserMenu({ compact }: { compact?: boolean }) {
  const { profile, logout } = useAuth();
  const { choice, setChoice } = useTheme();
  const pop = usePopover();
  if (!profile) return null;

  return (
    <div className={styles.popWrap} ref={pop.ref}>
      <button
        type="button"
        className={compact ? styles.avatarButton : styles.userCard}
        onClick={pop.toggle}
        aria-expanded={pop.open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${profile.name}`}
        data-testid="user-menu"
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(profile.name)}
        </span>
        {compact ? null : (
          <span className={styles.userText}>
            <span className={styles.userName}>{profile.name}</span>
            <span className={styles.userRole}>{ROLE_LABEL[profile.role]}</span>
          </span>
        )}
      </button>
      {pop.open ? (
        <div className={`${styles.popover} ${compact ? "" : styles.popUp}`} role="menu" aria-label="Account">
          <div className={styles.menuHead}>
            <span className={styles.avatarLg} aria-hidden="true">
              {initials(profile.name)}
            </span>
            <span className={styles.menuWho}>
              <strong>{profile.name}</strong>
              <span>{profile.email}</span>
            </span>
          </div>
          <div className={styles.menuSection}>
            <span className={styles.menuLabel}>Theme</span>
            <div className={styles.segmented} role="radiogroup" aria-label="Theme">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => setChoice(value)}>
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => logout()}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
