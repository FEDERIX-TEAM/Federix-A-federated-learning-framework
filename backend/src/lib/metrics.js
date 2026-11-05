import { config } from '../../config/index.js';

let stamps = [];

export function recordRequest() {
  const now = Date.now();
  stamps.push(now);
  const { maxSamples } = config.requestMetrics;
  if (stamps.length > maxSamples) stamps = stamps.slice(-Math.floor(maxSamples / 2));
}

export function requestsLastMinute() {
  const cutoff = Date.now() - config.requestMetrics.windowMs;
  stamps = stamps.filter((t) => t >= cutoff);
  return stamps.length;
}
