from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_core import (
    ImportReport,
    OnlineOcrClient,
    OnlineOcrProviderResult,
    process_raw_ingestion_job,
)


def main() -> None:
    load_worker_env()
    report = process_raw_ingestion_job()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "ImportReport",
    "OnlineOcrClient",
    "OnlineOcrProviderResult",
    "process_raw_ingestion_job",
    "main",
]


if __name__ == "__main__":
    main()
