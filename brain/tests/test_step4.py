import json
import math
import random
from pathlib import Path

import pytest
import torch
from torch.utils.data import Subset, TensorDataset

from federix.config import Config, ConfigError
from federix.utility import label_counts, label_entropy, tier, utility

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "spec" / "utility_vectors.json").read_text())
TOLERANCE = 1e-12


def config_from_vector(overrides):
    v = {**VECTORS["default_config"], **overrides}
    return Config(
        a=v["weight_quality"], b=v["weight_size"], c=v["weight_diversity"], eps=VECTORS["epsilon"],
        size_saturation=float(v["size_saturation"]), num_classes=v["num_classes"], temperature=v["temperature"],
        tau_high=v["utility_threshold_high"], tau_low=v["utility_threshold_low"],
        ratios=(v["ratio_high"], v["ratio_medium"], v["ratio_low"]), reject_below=v["reject_below"],
    ).validate()


def num(x):
    return float("nan") if x == "NaN" else x


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_matches_the_shared_vector(case):
    cfg = config_from_vector(case["config"])
    inp = case["input"]
    got = utility(num(inp["local_loss_before"]), num(inp["local_loss_after"]), inp["data_size"], inp["label_distribution"], cfg)
    if case["expected"] is None:
        assert got is None
    else:
        for key in ("quality", "size", "diversity", "score"):
            assert abs(getattr(got, key) - case["expected"][key]) < TOLERANCE, key
    t = tier(got.score if got else None, cfg)
    assert (t.status, t.level, t.ratio) == (case["tier"]["status"], case["tier"]["level"], case["tier"]["ratio"])


def test_the_vector_file_covers_the_important_cases():
    names = " ".join(c["name"] for c in VECTORS["cases"])
    for must in ("NOT full diversity", "rejected when reject_below", "ratio_high below 1", "invalid"):
        assert must in names
    assert VECTORS["epsilon"] == Config().eps


def test_more_improvement_more_data_and_more_balance_never_lower_the_score():
    cfg = Config()
    base = utility(1.0, 0.6, 200, {"0": 50, "1": 50}, cfg).score
    assert utility(1.0, 0.3, 200, {"0": 50, "1": 50}, cfg).score > base
    assert utility(1.0, 0.6, 2000, {"0": 50, "1": 50}, cfg).score > base
    assert utility(1.0, 0.6, 200, {str(i): 10 for i in range(10)}, cfg).score > base


def test_scores_stay_between_0_and_1():
    rng = random.Random(0)
    cfg = Config()
    for _ in range(500):
        u = utility(rng.uniform(0, 5), rng.uniform(0, 5), rng.randint(0, 10**6),
                    {str(i): rng.randint(0, 100) for i in range(rng.randint(0, 12))}, cfg)
        assert 0 <= u.score <= 1 and 0 <= u.quality <= 1 and 0 <= u.size <= 1 and 0 <= u.diversity <= 1


def test_diversity_is_normalised_by_num_classes():
    assert math.isclose(label_entropy({"0": 1, "1": 1}, 10), 1 / math.log2(10))
    assert label_entropy({"0": 1, "1": 1}, 2) == 1.0
    assert label_entropy({str(i): 3 for i in range(10)}, 10) == 1.0
    assert label_entropy({"0": 5}, 10) == 0.0


def test_bad_inputs_give_no_score():
    cfg = Config()
    for args in [(math.inf, 1, 10, {}), (1, -1, 10, {}), (1, 0.5, True, {}), (1, 0.5, 10, {"a": -1}),
                 (1, 0.5, 10, {"": 1}), (1, 0.5, 10, {"__proto__": 1}), (1, 0.5, 10, [1, 2])]:
        assert utility(*args, cfg) is None, args
    assert tier(None, cfg).status == "rejected"


def test_label_counts_reads_a_clients_training_labels():
    y = torch.tensor([0, 0, 1, 2, 2, 2, 7])
    ds = TensorDataset(torch.zeros(len(y), 1), y)
    assert label_counts(Subset(ds, [0, 1, 3, 4, 6])) == {"0": 2, "2": 2, "7": 1}


def test_utility_settings_are_validated():
    with pytest.raises(ConfigError) as info:
        Config.load(env={"FEDERIX_SIZE_SATURATION": "0", "FEDERIX_NUM_CLIENTS": "10", "FEDERIX_NUM_CLASSES": "1",
                         "FEDERIX_REJECT_BELOW": "0.5", "FEDERIX_TAU_LOW": "0.2"})
    text = str(info.value)
    assert "size_saturation must be > 0" in text
    assert "num_classes must be >= 2" in text
    assert "reject_below must be within [0, tau_low]" in text
