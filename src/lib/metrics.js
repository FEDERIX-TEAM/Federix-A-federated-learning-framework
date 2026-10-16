// Tiny sliding-window request counter used by SystemService.GetStats.
const WINDOW_MS = 60_000;
let stamps = [];

export function recordRequest() {
  const now = Date.now();
  stamps.push(now);
  if (stamps.length > 50_000) stamps = stamps.slice(-25_000);
}

export function requestsLastMinute() {
  const cutoff = Date.now() - WINDOW_MS;
  stamps = stamps.filter((t) => t >= cutoff);
  return stamps.length;
}
