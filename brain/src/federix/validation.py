from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Verdict:
    accepted: bool
    reason: str = ""
    norm: float = 0.0
    holdout_loss: float | None = None


def validate_updates(global_vec, deltas, cfg, holdout_loss=None):
    norms = [float(np.linalg.norm(np.asarray(d, dtype=np.float64))) for d in deltas]
    limit = None
    if cfg.max_update_norm_factor > 0 and len(norms) >= 3:
        limit = cfg.max_update_norm_factor * float(np.median(norms))

    g = np.asarray(global_vec, dtype=np.float32)
    first = []
    for d, norm in zip(deltas, norms):
        if not np.isfinite(norm):
            first.append(Verdict(False, "update is not finite", norm))
        elif limit is not None and norm > limit:
            first.append(Verdict(False, f"update norm {norm:.4g} is above {cfg.max_update_norm_factor}x the round median", norm))
        else:
            first.append(None)

    if not cfg.holdout_check or holdout_loss is None:
        return [v or Verdict(True, "", n) for v, n in zip(first, norms)]

    losses = [None if v else holdout_loss(g + np.asarray(d, dtype=np.float32)) for v, d in zip(first, deltas)]
    measured = [x for x in losses if x is not None and np.isfinite(x)]
    if len(measured) >= 3:
        reference, label = float(np.median(measured)), "the round median"
    else:
        reference, label = holdout_loss(g), "the current model"
    limit_loss = reference * (1 + cfg.holdout_loss_tolerance)

    verdicts = []
    for v, loss, norm in zip(first, losses, norms):
        if v:
            verdicts.append(v)
        elif not np.isfinite(loss) or loss > limit_loss:
            verdicts.append(Verdict(False, f"server holdout loss {loss:.4g} is above {1 + cfg.holdout_loss_tolerance:.2f}x {label} ({reference:.4f})", norm, loss))
        else:
            verdicts.append(Verdict(True, "", norm, loss))
    return verdicts
