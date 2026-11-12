import { bytes, percent, shortId } from "@/lib/format";

export type EventTone = "accent" | "ok" | "warn" | "bad" | "info" | "violet" | "neutral";
export type EventKind = "round" | "client" | "update" | "model" | "server" | "config" | "system";

export interface FeedEvent {
  id: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface Described {
  title: string;
  detail: string;
  tone: EventTone;
  kind: EventKind;
}

const READY_REASON: Record<string, string> = {
  all_submitted: "every participant submitted",
  max_updates: "it reached its update limit",
  deadline: "its deadline passed",
};

const FL_STATE: Record<string, string> = {
  starting: "is starting",
  idle: "is idle",
  aggregating: "is aggregating",
  error: "reported an error",
};

export const INVALIDATES: Record<string, string[][]> = {
  round_started: [["overview"], ["rounds"]],
  round_client_joined: [["overview"], ["rounds"]],
  round_client_left: [["overview"], ["rounds"]],
  round_update_received: [["overview"], ["rounds"]],
  round_ready: [["overview"], ["rounds"]],
  round_aggregating: [["overview"], ["rounds"], ["fl-status"]],
  round_completed: [["overview"], ["rounds"], ["convergence"], ["fl-status"]],
  round_failed: [["overview"], ["rounds"], ["fl-status"]],
  round_aborted: [["overview"], ["rounds"]],
  client_banned: [["overview"]],
  fl_server_status: [["fl-status"]],
  config_updated: [["config"]],
  system_maintenance: [["system", "health"]],
};

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function roundLabel(payload: Record<string, unknown>, numbers: Map<string, number>): string {
  const n = num(payload.round_number) ?? numbers.get(str(payload.round_id));
  return n ? `Round ${n}` : "The round";
}

export function describeEvent(e: FeedEvent, numbers: Map<string, number> = new Map()): Described {
  const p = e.payload;
  const round = roundLabel(p, numbers);
  const client = p.client_id ? `Client ${shortId(str(p.client_id))}` : "A client";
  switch (e.type) {
    case "round_started": {
      const max = num(p.max_clients);
      return { title: `${round} started`, detail: max ? `Open to ${max} clients` : "Open for clients", tone: "accent", kind: "round" };
    }
    case "round_client_joined": {
      const count = num(p.participant_count);
      return { title: `${client} joined`, detail: `${round}${count !== null ? ` · ${count} participant${count === 1 ? "" : "s"}` : ""}`, tone: "info", kind: "client" };
    }
    case "round_client_left":
      return { title: `${client} left`, detail: `${round}${p.reason ? ` · ${str(p.reason)}` : ""}`, tone: "warn", kind: "client" };
    case "round_update_received": {
      const status = str(p.status);
      const utility = num(p.utility_score);
      const size = num(p.bytes);
      const parts = [round, utility !== null ? `utility ${utility.toFixed(2)}` : "", size ? bytes(size) : ""].filter(Boolean);
      const verb = status === "rejected" ? "rejected" : status === "compressed" ? "accepted, compressed" : "accepted";
      return { title: `Update ${verb} from ${shortId(str(p.client_id)) || "a client"}`, detail: parts.join(" · "), tone: status === "rejected" ? "bad" : "ok", kind: "update" };
    }
    case "round_ready": {
      const why = READY_REASON[str(p.reason)];
      return { title: `${round} is ready to aggregate`, detail: [why ? `Because ${why}` : "", num(p.update_count) !== null ? `${p.update_count} updates` : ""].filter(Boolean).join(" · "), tone: "violet", kind: "round" };
    }
    case "round_aggregating":
      return { title: `Aggregating ${round.toLowerCase()}`, detail: `${num(p.accepted_updates) ?? 0} updates going into the model`, tone: "violet", kind: "round" };
    case "round_completed": {
      const acc = num(p.accuracy);
      return { title: `${round} complete`, detail: [p.model_version ? `Model v${p.model_version}` : "", acc !== null ? `accuracy ${percent(acc)}` : ""].filter(Boolean).join(" · "), tone: "ok", kind: "model" };
    }
    case "round_failed":
      return { title: `${round} failed`, detail: str(p.reason) || "No reason given", tone: "bad", kind: "round" };
    case "round_aborted":
      return { title: `${round} stopped`, detail: str(p.reason) || "Stopped before aggregation", tone: "warn", kind: "round" };
    case "client_banned":
      return { title: `${client} banned`, detail: p.banned_until ? `Until ${new Date(str(p.banned_until)).toLocaleString()}` : "Permanently", tone: "bad", kind: "client" };
    case "fl_server_status": {
      const state = str(p.state);
      return { title: `FL server ${FL_STATE[state] ?? state}`, detail: str(p.worker_id) ? `Worker ${str(p.worker_id)}` : "", tone: state === "error" ? "bad" : state === "aggregating" ? "violet" : "neutral", kind: "server" };
    }
    case "config_updated": {
      const keys = Object.keys(p);
      return { title: "Configuration changed", detail: keys.length ? keys.slice(0, 3).join(", ") + (keys.length > 3 ? ` +${keys.length - 3}` : "") : "", tone: "info", kind: "config" };
    }
    case "system_maintenance":
      return { title: p.enabled ? "Maintenance mode on" : "Maintenance mode off", detail: str(p.message), tone: p.enabled ? "warn" : "ok", kind: "system" };
    default:
      return { title: e.type.replace(/_/g, " "), detail: "", tone: "neutral", kind: "system" };
  }
}

export function parsePayload(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
