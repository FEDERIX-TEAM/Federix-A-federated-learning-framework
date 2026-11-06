import math
from dataclasses import dataclass

FORBIDDEN_KEYS = {"__proto__", "constructor", "prototype"}
MAX_LABEL_KEY_LENGTH = 64


@dataclass(frozen=True)
class Utility:
    quality: float
    size: float
    diversity: float
    score: float


@dataclass(frozen=True)
class Tier:
    status: str
    level: str | None
    ratio: float


def _finite_non_negative(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0


def valid_label_counts(counts):
    if counts is None:
        return True
    if not isinstance(counts, dict):
        return False
    for key, value in counts.items():
        if not isinstance(key, str) or not key or len(key) > MAX_LABEL_KEY_LENGTH:
            return False
        if "." in key or "$" in key or key in FORBIDDEN_KEYS:
            return False
        if not _finite_non_negative(value):
            return False
    return True


def label_entropy(counts, num_classes):
    positive = [c for c in (counts or {}).values() if _finite_non_negative(c) and c > 0]
    total = sum(positive)
    if total == 0 or len(positive) <= 1:
        return 0.0
    h = -sum((c / total) * math.log2(c / total) for c in positive)
    classes = num_classes if isinstance(num_classes, int) and num_classes >= 2 else len(positive)
    return min(1.0, h / math.log2(classes))


def utility(loss_before, loss_after, data_size, label_counts, cfg):
    if not all(_finite_non_negative(v) for v in (loss_before, loss_after, data_size)):
        return None
    if not valid_label_counts(label_counts):
        return None
    weights = cfg.a + cfg.b + cfg.c
    if weights <= 0 or cfg.size_saturation <= 0:
        return None

    quality = min(1.0, max(0.0, (loss_before - loss_after) / (loss_before + cfg.eps)))
    size = 1 - math.exp(-data_size / cfg.size_saturation)
    diversity = label_entropy(label_counts, cfg.num_classes)
    score = (cfg.a * quality + cfg.b * size + cfg.c * diversity) / weights
    if not all(math.isfinite(x) for x in (quality, size, diversity, score)):
        return None
    return Utility(quality, size, diversity, min(1.0, max(0.0, score)))


def tier(score, cfg):
    if score is None or not math.isfinite(score):
        return Tier("rejected", None, 0)
    if cfg.reject_below > 0 and score < cfg.reject_below:
        return Tier("rejected", None, 0)
    high, medium, low = cfg.ratios
    if score >= cfg.tau_high:
        full = high >= 1
        return Tier("accepted" if full else "compressed", "none" if full else "partial", high)
    if score >= cfg.tau_low:
        return Tier("compressed", "partial", medium)
    return Tier("compressed", "full", low)


def label_counts(subset):
    dataset, indices = subset.dataset, subset.indices
    targets = dataset.tensors[1][indices]
    values, counts = targets.unique(return_counts=True)
    return {str(int(v)): int(c) for v, c in zip(values, counts)}
