from __future__ import annotations

import json
from dataclasses import asdict
from typing import Sequence

from campus_ingestion_core.collection_runtime_audit import audit_collection_runtime_state

from campus_ingestion_worker.env_bootstrap import load_worker_env


def main(argv: Sequence[str] | None = None) -> None:
    del argv
    load_worker_env()
    report = audit_collection_runtime_state()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["audit_collection_runtime_state", "main"]


if __name__ == "__main__":
    main()
