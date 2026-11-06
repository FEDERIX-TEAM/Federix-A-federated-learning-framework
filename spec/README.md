# Shared test vectors

Files here are read by the tests of more than one component, so implementations written in different languages
must produce the same numbers.

| File | Used by | Contents |
|---|---|---|
| `utility_vectors.json` | `backend/test/utilityScore.test.js`, `backend/test/utilityV2.integration.test.js`, brain step 4 tests | Inputs, config overrides, the expected `quality`, `size`, `diversity` and `score`, and the expected tier for each case |
| `codec_vectors.json` | `brain/tests/test_step5.py`, the SDK codec tests | The FXW1 weight format: exact bytes for dense and top-k payloads, the top-k selection and tie rule, the dense fallback, two steps of error feedback, and a model-spec hash |

The expected values were computed by a separate Python implementation of the formula, not by either
component. When the formula changes, regenerate the file and update every implementation in the same change.
Implementations must match each value to within `1e-12`.
