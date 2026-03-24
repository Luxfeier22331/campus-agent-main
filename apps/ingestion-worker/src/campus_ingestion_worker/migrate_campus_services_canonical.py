from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_core import (
    CampusServicesObjectStoreMigrationReport,
    migrate_campus_services_canonical_to_object_store,
)


def main() -> None:
    load_worker_env()
    report = migrate_campus_services_canonical_to_object_store()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "CampusServicesObjectStoreMigrationReport",
    "migrate_campus_services_canonical_to_object_store",
    "main",
]


if __name__ == "__main__":
    main()
