from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager


@contextmanager
def suppress_transformers_missing_torch_advisory() -> Iterator[None]:
    env_key = "TRANSFORMERS_NO_ADVISORY_WARNINGS"
    previous_value = os.environ.get(env_key)
    if previous_value is None:
        os.environ[env_key] = "1"
    try:
        yield
    finally:
        if previous_value is None:
            os.environ.pop(env_key, None)
        else:
            os.environ[env_key] = previous_value
