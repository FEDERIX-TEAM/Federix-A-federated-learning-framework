import numpy as np

from federix_sdk.adapters.base import ModelAdapter

try:
    import keras
except ImportError as err:
    raise ImportError("the Keras adapter needs keras; install it with: pip install 'federix-sdk[keras]'") from err


class KerasAdapter(ModelAdapter):
    framework = "keras"

    def __init__(self, model, layout=None):
        if not model.built or not model.weights:
            raise ValueError("build the Keras model first (call it on an input or use keras.Input) so its weights exist")
        self.model = model
        names = [w.path for w in model.weights]
        if len(set(names)) != len(names):
            raise ValueError("Keras weight paths must be unique; give the layers distinct names")
        bad = [w.path for w in model.weights if str(w.dtype) != "float32"]
        if bad:
            raise ValueError(f"only float32 parameters are supported; convert these first: {', '.join(bad)}")
        super().__init__(layout)

    def _local_params(self):
        return [(w.path, np.asarray(keras.ops.convert_to_numpy(w.value))) for w in self.model.weights]

    def _load_local(self, arrays):
        for w in self.model.weights:
            w.assign(np.asarray(arrays[w.path], dtype=np.float32))
