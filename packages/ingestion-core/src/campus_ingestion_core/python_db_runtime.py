from __future__ import annotations

from typing import NoReturn

PYTHON_DB_RUNTIME_RETIRED_MESSAGE = (
    "Python database runtime is retired; use the TS ingestion-control/app-api "
    "or Go execution-control database owner instead"
)


def raise_python_db_runtime_retired(owner: str) -> NoReturn:
    raise RuntimeError(f"{PYTHON_DB_RUNTIME_RETIRED_MESSAGE}: {owner}")


__all__ = [
    "PYTHON_DB_RUNTIME_RETIRED_MESSAGE",
    "raise_python_db_runtime_retired",
]
