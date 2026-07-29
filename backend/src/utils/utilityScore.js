/**
 * Computes a utility score in [0, 1] for a submitted client update, combining:
 *  - loss improvement (how much local training reduced loss)
 *  - data size (larger, more representative datasets score higher, with diminishing returns)
 *  - label entropy (more balanced label distributions score higher)
 *
 * This is intentionally simple and swappable — real FL utility scoring
 * (e.g. FedProx-aware, contribution-based) can replace this function directly.
 */
function labelEntropy(labelDistribution = {}) {
  const counts = Object.values(labelDistribution).filter((n) => typeof n === 'number' && n > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || counts.length <= 1) return 0;

  const entropy = -counts.reduce((sum, c) => {
    const p = c / total;
    return sum + p * Math.log2(p);
  }, 0);

  const maxEntropy = Math.log2(counts.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

function computeUtilityScore({ localLossBefore, localLossAfter, dataSize, labelDistribution }) {
  const lossImprovement =
    localLossBefore > 0 ? Math.max(0, (localLossBefore - localLossAfter) / localLossBefore) : 0;

  const dataSizeScore = 1 - Math.exp(-dataSize / 500); // diminishing returns, saturates ~500 samples
  const entropyScore = labelEntropy(labelDistribution);

  const score = 0.5 * lossImprovement + 0.3 * dataSizeScore + 0.2 * entropyScore;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

module.exports = { computeUtilityScore, labelEntropy };
