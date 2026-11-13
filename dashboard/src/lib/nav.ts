import type { LucideIcon } from "lucide-react";
import { Activity, Boxes, Gauge, KeyRound, LayoutDashboard, LineChart, ScrollText, Settings2, ShieldCheck, Users } from "lucide-react";
import type { Role } from "@/lib/auth/session";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  roles: readonly Role[];
  group: "Monitor" | "Federation" | "Administration";
  keywords: string;
}

const EVERYONE = ["super_admin", "admin", "fl_engineer", "viewer"] as const;
const ADMINS = ["super_admin", "admin"] as const;

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Overview", description: "Federation health at a glance", icon: LayoutDashboard, roles: EVERYONE, group: "Monitor", keywords: "home dashboard kpi" },
  { href: "/metrics", label: "Metrics", description: "Convergence, communication and fairness", icon: LineChart, roles: EVERYONE, group: "Monitor", keywords: "charts accuracy loss bandwidth" },
  { href: "/rounds", label: "Rounds", description: "Start, follow and inspect training rounds", icon: Activity, roles: EVERYONE, group: "Federation", keywords: "training aggregation updates" },
  { href: "/clients", label: "Clients", description: "Participants, bans and API keys", icon: Users, roles: ADMINS, group: "Federation", keywords: "devices participants ban" },
  { href: "/enrollment", label: "Enrollment", description: "Tokens that let new clients join", icon: KeyRound, roles: ADMINS, group: "Federation", keywords: "tokens register invite" },
  { href: "/models", label: "Models", description: "Global model versions", icon: Boxes, roles: EVERYONE, group: "Federation", keywords: "weights versions download" },
  { href: "/config", label: "Configuration", description: "Training and utility settings", icon: Settings2, roles: EVERYONE, group: "Administration", keywords: "settings thresholds mu" },
  { href: "/users", label: "Users", description: "Dashboard accounts and roles", icon: ShieldCheck, roles: ["super_admin"], group: "Administration", keywords: "accounts admins roles" },
  { href: "/logs", label: "Audit log", description: "Who did what, and when", icon: ScrollText, roles: ADMINS, group: "Administration", keywords: "events history audit" },
  { href: "/system", label: "System", description: "Services, maintenance and cache", icon: Gauge, roles: ADMINS, group: "Administration", keywords: "health maintenance cache" },
];

export const GROUPS = ["Monitor", "Federation", "Administration"] as const;

export function itemFor(pathname: string): NavItem | undefined {
  return [...NAV].sort((a, b) => b.href.length - a.href.length).find((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

export const ACTIONS = {
  startRound: ["super_admin", "admin", "fl_engineer"],
  stopRound: ["super_admin", "admin"],
  roundDetail: ["super_admin", "admin", "fl_engineer"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ACTIONS;

export function can(role: Role, action: Action): boolean {
  return (ACTIONS[action] as readonly Role[]).includes(role);
}

const SUB_ROUTES: { prefix: string; label: string; action: Action }[] = [{ prefix: "/rounds/", label: "round details", action: "roundDetail" }];

export function restrictionFor(pathname: string): { label: string; action: Action } | undefined {
  return SUB_ROUTES.find((r) => pathname.startsWith(r.prefix) && pathname.length > r.prefix.length);
}

export function canAccess(role: Role, pathname: string): boolean {
  const sub = restrictionFor(pathname);
  if (sub && !can(role, sub.action)) return false;
  const item = itemFor(pathname);
  return item ? item.roles.includes(role) : true;
}

export function navFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  fl_engineer: "FL engineer",
  viewer: "Viewer",
};
