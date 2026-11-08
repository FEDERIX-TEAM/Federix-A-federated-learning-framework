import numpy as np

from federix_sdk.adapters.base import ModelAdapter

try:
    import jax
    import jax.numpy as jnp
except ImportError as err:
    raise ImportError("the JAX adapter needs jax; install it with: pip install 'federix-sdk[jax]'") from err


class JaxAdapter(ModelAdapter):
    framework = "jax"

    def __init__(self, params, layout=None):
        leaves, self._treedef = jax.tree_util.tree_flatten_with_path(params)
        if not leaves:
            raise ValueError("the parameter tree has no arrays")
        self._names = [jax.tree_util.keystr(path) for path, _ in leaves]
        self.params = params
        super().__init__(layout)

    def _local_params(self):
        leaves = jax.tree_util.tree_leaves(self.params)
        return [(name, np.asarray(leaf)) for name, leaf in zip(self._names, leaves)]

    def _load_local(self, arrays):
        self.params = jax.tree_util.tree_unflatten(self._treedef, [jnp.asarray(arrays[n], dtype=jnp.float32) for n in self._names])
