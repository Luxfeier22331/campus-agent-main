from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_regulation_owner_text_execution import (
    execute_collected_notice_regulation_owner_text_attempts,
)
from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrSettings,
    build_online_ocr_client,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_ATTEMPT_PLAN_PATH = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/"
    "regulation-owner-text-attempt-plan.json"
)
DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1b-regulation-owner-text-recovery-execution"
)
EXECUTION_REPORT_FILENAME = "regulation-owner-text-execution-report.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Execute Phase 6R.1b selected regulation owner-text recovery attempts. "
            "Writes normalized owner-text outputs only when --execute is set."
        )
    )
    parser.add_argument("--attempt-plan-path", default=str(DEFAULT_ATTEMPT_PLAN_PATH))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    attempt_plan_path = Path(args.attempt_plan_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    attempt_plan = _load_json_object(attempt_plan_path)
    report = execute_collected_notice_regulation_owner_text_attempts(
        attempt_plan=attempt_plan,
        object_store=build_runtime_object_store(),
        online_ocr_clients=build_runtime_online_ocr_clients(),
        execute=bool(args.execute),
    )
    report_path = output_dir / EXECUTION_REPORT_FILENAME
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    counts = report.get("counts", {})
    print(
        json.dumps(
            {
                "mode": report.get("mode"),
                "write_enabled": report.get("write_enabled"),
                "provider_calls_enabled": report.get("provider_calls_enabled"),
                "object_store_writes_enabled": report.get("object_store_writes_enabled"),
                "db_writes_enabled": report.get("db_writes_enabled"),
                "output_dir": str(output_dir),
                "report_path": str(report_path),
                "selected_count": counts.get("selected_count", 0),
                "succeeded_count": counts.get("succeeded_count", 0),
                "failed_count": counts.get("failed_count", 0),
                "owner_text_ready_count": counts.get("owner_text_ready_count", 0),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def build_runtime_object_store() -> S3ObjectStoreWriter:
    return S3ObjectStoreWriter(ObjectStoreSettings.from_env())


def build_runtime_online_ocr_clients() -> dict[str, OnlineOcrClient]:
    clients: dict[str, OnlineOcrClient] = {}
    primary_settings = OnlineOcrSettings.from_env(required=True)
    if primary_settings is not None:
        clients[primary_settings.provider] = build_online_ocr_client(primary_settings)
    mineru_settings = OnlineOcrSettings.from_env(
        prefix="OCR_MINERU_",
        default_provider=ONLINE_OCR_PROVIDER_MINERU_API,
    )
    if mineru_settings is not None:
        clients[mineru_settings.provider] = build_online_ocr_client(mineru_settings)
    return clients


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "EXECUTION_REPORT_FILENAME",
    "build_parser",
    "build_runtime_object_store",
    "build_runtime_online_ocr_clients",
    "execute_collected_notice_regulation_owner_text_attempts",
    "main",
]


if __name__ == "__main__":
    main()
