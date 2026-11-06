import { isFiniteNumber, isValidLabelDistribution } from '../src/lib/validate.js';

export const EPSILON = 1e-8;

export function labelEntropy(labelDistribution = {}, numClasses) {
  const counts = Object.values(labelDistribution ?? {}).filter((n) => isFiniteNumber(n) && n > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || counts.length <= 1) return 0;

  const entropy = -counts.reduce((sum, c) => {
    const p = c / total;
    return sum + p * Math.log2(p);
  }, 0);

  const classes = Number.isInteger(numClasses) && numClasses >= 2 ? numClasses : counts.length;
  return Math.min(1, entropy / Math.log2(classes));
}

export function utilityComponents({ localLossBefore, localLossAfter, dataSize, labelDistribution }, cfg) {
  if (
    !isFiniteNumber(localLossBefore) || localLossBefore < 0 ||
    !isFiniteNumber(localLossAfter) || localLossAfter < 0 ||
    !isFiniteNumber(dataSize) || dataSize < 0 ||
    !isValidLabelDistribution(labelDistribution)
  ) {
    return null;
  }

  const a = cfg.weight_quality;
  const b = cfg.weight_size;
  const c = cfg.weight_diversity;
  const weights = a + b + c;
  if (!(weights > 0) || !(cfg.size_saturation > 0)) return null;

  const quality = Math.min(1, Math.max(0, (localLossBefore - localLossAfter) / (localLossBefore + EPSILON)));
  const size = 1 - Math.exp(-dataSize / cfg.size_saturation);
  const diversity = labelEntropy(labelDistribution, cfg.num_classes);
  const score = (a * quality + b * size + c * diversity) / weights;

  if (![quality, size, diversity, score].every(Number.isFinite)) return null;
  return { quality, size, diversity, score: Math.min(1, Math.max(0, score)) };
}

export function computeUtilityScore(input, cfg) {
  return utilityComponents(input, cfg)?.score ?? null;
}

export function utilityTier(score, cfg) {
  if (score === null || !Number.isFinite(score)) {
    return { status: 'rejected', level: null, ratio: 0, reason: 'utility score could not be computed from the submitted metrics' };
  }
  if (cfg.reject_below > 0 && score < cfg.reject_below) {
    return { status: 'rejected', level: null, ratio: 0, reason: `utility score ${score.toFixed(4)} is below the rejection threshold ${cfg.reject_below}` };
  }
  if (score >= cfg.utility_threshold_high) {
    const full = cfg.ratio_high >= 1;
    return { status: full ? 'accepted' : 'compressed', level: full ? 'none' : 'partial', ratio: cfg.ratio_high, reason: null };
  }
  if (score >= cfg.utility_threshold_low) return { status: 'compressed', level: 'partial', ratio: cfg.ratio_medium, reason: null };
  return { status: 'compressed', level: 'full', ratio: cfg.ratio_low, reason: null };
}

export function utilityConfigToProto(cfg) {
  return {
    weightQuality: cfg.weight_quality,
    weightSize: cfg.weight_size,
    weightDiversity: cfg.weight_diversity,
    sizeSaturation: cfg.size_saturation,
    numClasses: cfg.num_classes,
    temperature: cfg.temperature,
    thresholdHigh: cfg.utility_threshold_high,
    thresholdLow: cfg.utility_threshold_low,
    ratioHigh: cfg.ratio_high,
    ratioMedium: cfg.ratio_medium,
    ratioLow: cfg.ratio_low,
    rejectBelow: cfg.reject_below,
  };
}
