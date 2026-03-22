from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_core import RawIngestionSubmissionReport, submit_raw_ingestion_job


def main() -> None:
    report = submit_raw_ingestion_job()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["RawIngestionSubmissionReport", "submit_raw_ingestion_job", "main"]


if __name__ == "__main__":
    main()
