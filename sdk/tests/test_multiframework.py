import numpy as np
import pytest
import torch
import torch.nn as nn
import torch.nn.functional as F

import jax
import jax.numpy as jnp
import keras

from federix_sdk import FederixClient, Layout, LayoutError, decode
from federix_sdk.adapters.jax import JaxAdapter
from federix_sdk.adapters.keras import KerasAdapter
from federix_sdk.adapters.pytorch import TorchAdapter
from federix_sdk.trainer import RoundConfig
from federix_sdk.trainers.jax import JaxFedProxTrainer
from federix_sdk.trainers.keras import KerasFedProxTrainer
from federix_sdk.trainers.pytorch import TorchFedProxTrainer

from test_round_client import fresh_round, new_session, prototypes, round_updates, Transfers

HIDDEN = 32


def torch_model():
    return nn.Sequential(nn.Flatten(), nn.Linear(784, HIDDEN), nn.ReLU(), nn.Linear(HIDDEN, 10))


def keras_model():
    return keras.Sequential([keras.Input((784,)), keras.layers.Dense(HIDDEN, activation="relu", name="hidden"), keras.layers.Dense(10, name="out")])


def keras_layout(model):
    path = {w.path.split("/")[-2] + "/" + w.path.split("/")[-1]: w.path for w in model.weights}
    return Layout([
        ("1.weight", path["hidden/kernel"], True),
        ("1.bias", path["hidden/bias"]),
        ("3.weight", path["out/kernel"], True),
        ("3.bias", path["out/bias"]),
    ])


def jax_params(seed=0):
    k1, k2 = jax.random.split(jax.random.PRNGKey(seed))
    return {
        "hidden": {"w": jax.random.normal(k1, (784, HIDDEN)) * 0.05, "b": jnp.zeros(HIDDEN)},
        "out": {"w": jax.random.normal(k2, (HIDDEN, 10)) * 0.05, "b": jnp.zeros(10)},
    }


def jax_apply(params, x):
    h = jax.nn.relu(x @ params["hidden"]["w"] + params["hidden"]["b"])
    return h @ params["out"]["w"] + params["out"]["b"]


JAX_LAYOUT = Layout([
    ("1.weight", "['hidden']['w']", True),
    ("1.bias", "['hidden']['b']"),
    ("3.weight", "['out']['w']", True),
    ("3.bias", "['out']['b']"),
])


def numpy_data(n, seed):
    ds = prototypes(n, seed)
    return ds.tensors[0].reshape(n, -1).numpy(), ds.tensors[1].numpy()


def test_the_same_network_has_one_spec_in_every_framework():
    t = TorchAdapter(torch_model())
    k = KerasAdapter(km := keras_model(), keras_layout(km))
    j = JaxAdapter(jax_params(), JAX_LAYOUT)
    assert t.spec().hash == k.spec().hash == j.spec().hash
    assert [p.shape for p in k.spec().params] == [(HIDDEN, 784), (HIDDEN,), (10, HIDDEN), (10,)]


def test_the_same_weights_give_the_same_outputs_in_every_framework():
    torch.manual_seed(0)
    tm = torch_model()
    canonical = TorchAdapter(tm).get_weights()
    km = keras_model()
    KerasAdapter(km, keras_layout(km)).set_weights(canonical)
    ja = JaxAdapter(jax_params(), JAX_LAYOUT)
    ja.set_weights(canonical)

    x, _ = numpy_data(16, seed=5)
    with torch.no_grad():
        expected = tm(torch.from_numpy(x)).numpy()
    np.testing.assert_allclose(np.asarray(km(x)), expected, rtol=1e-4, atol=1e-5)
    np.testing.assert_allclose(np.asarray(jax_apply(ja.params, x)), expected, rtol=1e-4, atol=1e-5)
    np.testing.assert_array_equal(KerasAdapter(km, keras_layout(km)).get_weights(), canonical)
    np.testing.assert_array_equal(ja.get_weights(), canonical)


def test_layout_mistakes_are_explained():
    params = jax_params()
    with pytest.raises(LayoutError, match="no parameters named"):
        JaxAdapter(params, Layout([("a", "['nope']"), ("b", "['hidden']['b']"), ("c", "['out']['w']"), ("d", "['out']['b']")]))
    with pytest.raises(LayoutError, match="not in the layout"):
        JaxAdapter(params, Layout([("a", "['hidden']['w']")]))
    with pytest.raises(LayoutError, match="only 2-D parameters can be transposed"):
        JaxAdapter(params, Layout([("a", "['hidden']['w']"), ("b", "['hidden']['b']", True), ("c", "['out']['w']"), ("d", "['out']['b']")]))
    with pytest.raises(LayoutError, match="unique"):
        Layout([("a", "x"), ("a", "y")])
    with pytest.raises(LayoutError, match="only once"):
        Layout([("a", "x"), ("b", "x")])


def test_keras_adapter_needs_a_built_float32_model_and_includes_non_trainable_weights():
    with pytest.raises(ValueError, match="build the Keras model first"):
        KerasAdapter(keras.Sequential([keras.layers.Dense(4)]))
    bn = keras.Sequential([keras.Input((3,)), keras.layers.Dense(4), keras.layers.BatchNormalization()])
    names = [p.name for p in KerasAdapter(bn).spec().params]
    assert any("moving_mean" in n for n in names) and any("moving_variance" in n for n in names)
    with pytest.raises(ValueError, match="float32"):
        KerasAdapter(keras.Sequential([keras.Input((3,)), keras.layers.Dense(2, dtype="float64")]))


def test_jax_adapter_round_trips_any_pytree_and_refuses_float64():
    a = JaxAdapter({"layer": [jnp.ones((2, 3)), jnp.zeros(4)]})
    v = np.arange(10, dtype=np.float32)
    a.set_weights(v)
    np.testing.assert_array_equal(a.get_weights(), v)
    assert a.params["layer"][0].shape == (2, 3)
    with pytest.raises(ValueError, match="float32"):
        JaxAdapter({"w": np.zeros(3, dtype=np.float64)})


@pytest.mark.parametrize("framework", ["keras", "jax"])
def test_jax_and_keras_trainers_learn_and_mu_keeps_clients_close(framework):
    train, val = numpy_data(400, seed=1), numpy_data(120, seed=2)

    def make():
        if framework == "keras":
            keras.utils.set_random_seed(0)
            m = keras_model()
            return KerasFedProxTrainer(m, train, val, lr=0.05, layout=keras_layout(m))
        return JaxFedProxTrainer(jax_params(0), jax_apply, train, val, lr=0.05, layout=JAX_LAYOUT)

    free, tied = make(), make()
    start = free.adapter.get_weights()
    tied.adapter.set_weights(start)
    r_free = free.train(RoundConfig(mu=0.0, local_epochs=3, batch_size=32))
    r_tied = tied.train(RoundConfig(mu=10.0, local_epochs=3, batch_size=32))
    assert r_free.loss_after < r_free.loss_before
    assert np.linalg.norm(tied.adapter.get_weights() - start) < np.linalg.norm(free.adapter.get_weights() - start)
    assert free.num_samples() == 400 and sum(free.label_counts().values()) == 400


def test_the_keras_trainer_explains_the_backend_requirement(monkeypatch):
    monkeypatch.setattr(keras.backend, "backend", lambda: "tensorflow")
    with pytest.raises(RuntimeError, match="KERAS_BACKEND=jax"):
        KerasFedProxTrainer(keras_model(), numpy_data(10, 0), numpy_data(10, 1))


def test_pytorch_keras_and_jax_clients_take_part_in_one_round(tmp_path, backend):
    torch.manual_seed(0)
    initial = torch_model()
    round_id = fresh_round(backend, initial)

    def torch_trainer():
        return TorchFedProxTrainer(torch_model(), prototypes(500, 11), prototypes(120, 12))

    def keras_trainer():
        m = keras_model()
        return KerasFedProxTrainer(m, numpy_data(500, 21), numpy_data(120, 22), layout=keras_layout(m))

    def jax_trainer():
        return JaxFedProxTrainer(jax_params(3), jax_apply, numpy_data(500, 31), numpy_data(120, 32), layout=JAX_LAYOUT)

    outcomes = {}
    for name, make in (("pytorch", torch_trainer), ("keras", keras_trainer), ("jax", jax_trainer)):
        session = new_session(tmp_path, backend)
        with FederixClient(session, make()) as client:
            outcomes[name] = client.run_round(round_id)
        session.close()
    assert {k: o.status for k, o in outcomes.items()} == {"pytorch": "submitted", "keras": "submitted", "jax": "submitted"}

    spec = TorchAdapter(initial).spec()
    entries = round_updates(backend, round_id)
    assert len(entries) == 3
    deltas = [decode(Transfers().download(e.download_url), expected_digest=spec.digest)[0].to_dense() for e in entries]

    held_out = prototypes(300, 999)
    with torch.no_grad():
        before = F.cross_entropy(initial(held_out.tensors[0]), held_out.tensors[1]).item()
        merged = torch_model()
        TorchAdapter(merged).set_weights(TorchAdapter(initial).get_weights() + np.mean(deltas, axis=0))
        after = F.cross_entropy(merged(held_out.tensors[0]), held_out.tensors[1]).item()
    assert after < before


def test_an_unstable_learning_rate_and_mu_are_warned_about(caplog):
    from federix_sdk.trainer import warn_if_unstable
    with caplog.at_level("WARNING", logger="federix_sdk"):
        assert warn_if_unstable(0.05, 50) is True
        assert warn_if_unstable(0.05, 10) is False
    assert "will diverge" in caplog.text
