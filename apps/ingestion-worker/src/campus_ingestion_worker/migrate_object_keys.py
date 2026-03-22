from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_core import ObjectKeyMigrationReport, migrate_registry_object_keys_from_env


def main() -> None:
    report = migrate_registry_object_keys_from_env()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["ObjectKeyMigrationReport", "migrate_registry_object_keys_from_env", "main"]


if __name__ == "__main__":
    main()
