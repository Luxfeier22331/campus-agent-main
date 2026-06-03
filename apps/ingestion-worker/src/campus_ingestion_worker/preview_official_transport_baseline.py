from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.official_transport_baseline_preview import (
    build_official_transport_baseline_preview,
)
from campus_ingestion_core.online_ocr_evidence import extract_provider_plain_text
from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrProviderResult,
    OnlineOcrSettings,
    build_online_ocr_client,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_06_2_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview official transport baseline OCR ingest without DB/object writes.",
    )
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--source-image-path")
    input_group.add_argument("--ocr-plain-text-path")
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_06_2_OUTPUT_DIR))
    parser.add_argument("--baseline-reference-date", default="2026-03-01")
    parser.add_argument(
        "--source-ref",
        default="official_transport_baseline:local-probe:20260429-222640",
    )
    parser.add_argument("--provider", default="mineru_api")
    parser.add_argument("--model", default="vlm")
    parser.add_argument("--provider-batch-id", default="")
    parser.add_argument("--service-horizon-days", type=int, default=90)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ocr_result = _resolve_ocr_text(args)
    preview = build_official_transport_baseline_preview(
        ocr_plain_text=ocr_result["plain_text"],
        baseline_reference_date=str(args.baseline_reference_date),
        generated_at=_generated_at(),
        source_ref=str(args.source_ref),
        provider=str(ocr_result["provider"]),
        model=str(ocr_result["model"]),
        provider_batch_id=str(ocr_result["provider_batch_id"]),
        service_horizon_days=int(args.service_horizon_days),
    )
    files = write_official_transport_baseline_evidence_files(
        preview=preview,
        ocr_plain_text=str(ocr_result["plain_text"]),
        output_dir=output_dir,
    )
    payload = {
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "output_dir": str(output_dir),
        "files": {name: str(path) for name, path in files.items()},
        "baseline_reference_date": preview["baseline"]["reference_date"],
        "baseline_effective_from": preview["baseline"]["effective_from"],
        "canonical_row_count": preview["counts"]["canonical_row_count"],
        "scheduled_departure_count": preview["counts"]["scheduled_departure_count"],
        "consistency_verdict": preview["consistency"]["verdict"],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def write_official_transport_baseline_evidence_files(
    *,
    preview: dict[str, object],
    ocr_plain_text: str,
    output_dir: Path,
) -> dict[str, Path]:
    files = {
        "official-baseline-canonical-preview.json": preview,
        "official-baseline-consistency-report.json": preview["consistency"],
        "official-baseline-ocr-probe-report.json": {
            "schema_version": "official_transport_baseline_ocr_probe.v1",
            "mode": "dry_run",
            "write_enabled": False,
            "ocr": preview["ocr"],
        },
    }
    written: dict[str, Path] = {}
    for filename, payload in files.items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    text_path = output_dir / "official-baseline-ocr-plain-text.md"
    text_path.write_text(ocr_plain_text.rstrip() + "\n", encoding="utf-8")
    written[text_path.name] = text_path
    return written


def _resolve_ocr_text(args: argparse.Namespace) -> dict[str, str]:
    if args.ocr_plain_text_path:
        return {
            "plain_text": Path(args.ocr_plain_text_path).read_text(encoding="utf-8"),
            "provider": str(args.provider),
            "model": str(args.model),
            "provider_batch_id": str(args.provider_batch_id),
        }
    settings = OnlineOcrSettings.from_env(
        required=True,
        prefix="OCR_MINERU_",
        default_provider=ONLINE_OCR_PROVIDER_MINERU_API,
    )
    client = build_online_ocr_client(settings)
    provider_result = client.parse_file(Path(args.source_image_path))
    plain_text = extract_provider_plain_text(
        provider=settings.provider,
        provider_response_bytes=provider_result.provider_result_bytes,
    )
    return {
        "plain_text": plain_text,
        "provider": settings.provider,
        "model": settings.model,
        "provider_batch_id": _provider_batch_id(provider_result),
    }


def _provider_batch_id(result: OnlineOcrProviderResult) -> str:
    metadata = result.metadata or {}
    return str(metadata.get("batch_id") or "")


def _generated_at() -> str:
    from campus_ingestion_core.campusrag_ingestion_reporting import utc_now

    return utc_now()


__all__ = [
    "build_parser",
    "main",
    "write_official_transport_baseline_evidence_files",
]


if __name__ == "__main__":
    main()
