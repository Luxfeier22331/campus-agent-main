from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_core import LocalDataRebuildReport, rebuild_local_data


def main() -> None:
    report = rebuild_local_data()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["LocalDataRebuildReport", "rebuild_local_data", "main"]


if __name__ == "__main__":
    main()
