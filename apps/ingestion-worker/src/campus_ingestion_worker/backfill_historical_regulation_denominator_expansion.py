from __future__ import annotations

import argparse
import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    build_admission_preflight_report,
    build_first_batch_regulation_selection,
    build_source_to_target_trace,
    materialize_first_batch_regulation_selection,
)
from campus_ingestion_core.collected_notice_regulation_materialization_preview import (
    build_collected_notice_regulation_materialization_preview,
)
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_candidate_store_noop_assertion,
    build_historical_regulation_chunk_backfill_evidence,
    build_serving_closed_assertion,
    prepare_historical_regulation_chunk_backfill_chunks,
)
from campus_ingestion_core.historical_regulation_denominator_body_text_admission import (
    DEFAULT_HISTORICAL_REGULATION_DENOMINATOR_PHASE,
    build_historical_regulation_body_text_owner_admission,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_institutional_regulation_chunk_prep import (
    prepare_institutional_regulation_chunks,
)
from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    prepare_scoped_rule_chunks,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED, DEFAULT_BUCKET_SOURCE

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_READY_CANDIDATES_PATH = Path(
    ".planning/workstreams/historical-regulation-denominator-expansion/evidence/"
    "phase-00-denominator-audit/ready-canonical-chunk-candidates.json"
)
DEFAULT_NORMALIZED_BUNDLE_PATH = Path(
    ".tmp/historical-intake/run14-policy-regulation-expanded/normalized/"
    "notices-bundle.normalized.json"
)
DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/historical-regulation-denominator-expansion/evidence/"
    "phase-01-04-canonical-chunk-backfill"
)
PHASE_ID = DEFAULT_HISTORICAL_REGULATION_DENOMINATOR_PHASE
_IMPORT_SOURCE = "historical_regulation_denominator_expansion"
_PARSER_VERSION = "historical_regulation_denominator_expansion_v1"
_SOURCE_KEY_RE = re.compile(
    r"^authenticated_notice_portal/notice-[0-9]+/[0-9]{4}/"
    r"run[0-9]+-[^/]+/notice-[0-9]+/source-truth/[^/]+$"
)
_DERIVED_KEY_RE = re.compile(
    r"^regulations/documents/(?:institutional_rules|scoped_rules)/[^/]+/"
    r"current-effective/(?:[0-9]{4}|undated)/(?:canonical\.md|document-units\.jsonl)$"
)


class LocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        path = self.root / bucket / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def backfill_historical_regulation_denominator_expansion_from_paths(
    *,
    ready_candidates_path: Path,
    normalized_bundle_path: Path,
    output_dir: Path,
    execute: bool,
    generated_at: str | None = None,
    object_store: Any | None = None,
    document_registry: Any | None = None,
    raw_asset_registry: Any | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    runtime_output_dir = Path(output_dir)
    source_env = _default_env(env)
    runtime_object_store = object_store or LocalFilesystemObjectStore(
        runtime_output_dir / "object-store"
    )
    runtime_document_registry = document_registry or InMemoryDocumentRegistry(
        runtime_output_dir / "phase-02-canonical-materialization/document-registry.json"
    )
    runtime_raw_asset_registry = raw_asset_registry or InMemoryRawAssetRegistry(
        runtime_output_dir / "phase-02-canonical-materialization/raw-asset-registry.json"
    )
    phase01 = runtime_output_dir / "phase-01-body-text-admission"
    phase02 = runtime_output_dir / "phase-02-canonical-materialization"
    phase03 = runtime_output_dir / "phase-03-chunk-preparation"
    phase04 = runtime_output_dir / "phase-04-quality-audit"

    admission = build_historical_regulation_body_text_owner_admission(
        ready_candidates=_load_json_object(Path(ready_candidates_path)),
        normalized_notice_bundle=_load_json_any(Path(normalized_bundle_path)),
        object_store=runtime_object_store,
        bucket_source=str(source_env["OBJECT_STORE_BUCKET_SOURCE"]),
        generated_at=generated_at,
    )
    phase01_files = write_phase01_evidence_files(output_dir=phase01, admission=admission)

    preview = build_collected_notice_regulation_materialization_preview(
        admission_manifest=admission["admission_manifest"],
        object_store=runtime_object_store,
        generated_at=generated_at,
        phase_id=PHASE_ID,
        generated_by="campus_ingestion_worker.backfill_historical_regulation_denominator_expansion",
        evidence_refs={
            "admission_manifest": str(phase01_files["regulation-consumer-admission-manifest.json"])
        },
    )
    selection = build_first_batch_regulation_selection(
        candidate_audit=admission["candidate_audit"],
        consistency_report=preview.consistency_report,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        selected_notice_ids=admission["selected_notice_ids"],
        generated_at=generated_at,
        phase_id=PHASE_ID,
    )
    admission_preflight = build_admission_preflight_report(
        selection=selection,
        generated_at=generated_at,
        phase_id=PHASE_ID,
    )
    materialization_report = materialize_first_batch_regulation_selection(
        selection=selection,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        object_store=runtime_object_store,
        execute=execute,
        env=source_env,
        generated_at=generated_at,
        phase_id=PHASE_ID,
        import_source=_IMPORT_SOURCE,
        parser_version=_PARSER_VERSION,
    )
    phase02_payloads = {
        "selection.json": selection,
        "admission-preflight-report.json": admission_preflight,
        "institutional-rules-materialization.normalized.dry-run.json": (
            preview.institutional_rules_materialization
        ),
        "scoped-rules-materialization.normalized.dry-run.json": (
            preview.scoped_rules_materialization
        ),
        "regulation-normalization-quality-report.json": preview.normalization_quality_report,
        "regulation-normalization-before-after-report.json": preview.before_after_report,
        "regulation-normalization-consistency-report.json": preview.consistency_report,
        "source-preview-trace.json": preview.source_to_target_trace,
        "materialization.execute.json": materialization_report,
        "source-to-target-provenance-trace.json": build_source_to_target_trace(
            selection=selection,
            generated_at=generated_at,
            phase_id=PHASE_ID,
        ),
        "serving-closed-assertion.json": build_serving_closed_assertion(generated_at=generated_at),
    }
    phase02_files = write_mapping_files(output_dir=phase02, payloads=phase02_payloads)

    chunk_plan = build_historical_regulation_chunk_backfill_evidence(
        phase13_report={
            "selected_notice_ids": materialization_report.get("selected_notice_ids", []),
        },
        materialization_reports={"denominator_expansion": materialization_report},
        registry=runtime_document_registry,
        object_store=runtime_object_store,
        bucket_derived=str(source_env["OBJECT_STORE_BUCKET_DERIVED"]),
        preparation_run_id_prefix="historical-regulation-denominator-expansion",
        generated_at=generated_at,
    )
    chunk_evidence = prepare_historical_regulation_chunk_backfill_chunks(
        classification_report=chunk_plan["classification_report"],
        canonical_preflight=chunk_plan["canonical_provenance_preflight"],
        registry=runtime_document_registry,
        object_store=runtime_object_store,
        output_dir=phase03,
        bucket_derived=str(source_env["OBJECT_STORE_BUCKET_DERIVED"]),
        preparation_run_id_prefix="historical-regulation-denominator-expansion",
        generated_at=generated_at,
        prepare_institutional_chunks=prepare_institutional_regulation_chunks,
        prepare_scoped_chunks=prepare_scoped_rule_chunks,
    )
    phase03_payloads = {
        "target-inventory.json": chunk_plan["target_inventory"],
        "classification-report.json": chunk_plan["classification_report"],
        "canonical-provenance-preflight.json": chunk_plan["canonical_provenance_preflight"],
        "chunk-preparation-batch-report.json": chunk_evidence["chunk_preparation_batch_report"],
        "serving-closed-assertion.json": chunk_evidence["serving_closed_assertion"],
        "candidate-store-noop-assertion.json": chunk_evidence["candidate_store_noop_assertion"],
    }
    phase03_files = write_mapping_files(output_dir=phase03, payloads=phase03_payloads)

    final_audit = build_final_quality_audit(
        admission=admission,
        materialization_report=materialization_report,
        chunk_preparation_report=chunk_evidence["chunk_preparation_batch_report"],
        bucket_source=str(source_env["OBJECT_STORE_BUCKET_SOURCE"]),
        bucket_derived=str(source_env["OBJECT_STORE_BUCKET_DERIVED"]),
        generated_at=generated_at,
    )
    phase04_files = write_mapping_files(
        output_dir=phase04,
        payloads={
            "final-quality-audit.json": final_audit,
            "serving-closed-assertion.json": build_serving_closed_assertion(
                generated_at=generated_at
            ),
            "candidate-store-noop-assertion.json": build_candidate_store_noop_assertion(
                generated_at=generated_at
            ),
        },
    )
    return {
        "schema_version": ("historical-regulation-denominator-expansion-backfill-worker.v1"),
        "phase": PHASE_ID,
        "mode": "execute" if execute else "dry_run",
        "write_enabled": bool(execute),
        "output_dir": str(runtime_output_dir),
        "selected_notice_ids": list(materialization_report["selected_notice_ids"]),
        "selected_target_document_ids": list(
            materialization_report["selected_target_document_ids"]
        ),
        "materialized_document_count": int(materialization_report["materialized_document_count"]),
        "chunk_preparation": chunk_evidence["chunk_preparation_batch_report"],
        "serving_closed": build_serving_closed_assertion(generated_at=generated_at),
        "candidate_store_noop": build_candidate_store_noop_assertion(generated_at=generated_at),
        "files": {
            **{f"phase-01/{key}": str(value) for key, value in phase01_files.items()},
            **{f"phase-02/{key}": str(value) for key, value in phase02_files.items()},
            **{f"phase-03/{key}": str(value) for key, value in phase03_files.items()},
            **{f"phase-04/{key}": str(value) for key, value in phase04_files.items()},
        },
    }


def build_final_quality_audit(
    *,
    admission: Mapping[str, Any],
    materialization_report: Mapping[str, Any],
    chunk_preparation_report: Mapping[str, Any],
    bucket_source: str,
    bucket_derived: str,
    generated_at: str | None = None,
) -> dict[str, Any]:
    key_audit = _object_store_key_audit(
        admission=admission,
        materialization_report=materialization_report,
        bucket_source=bucket_source,
        bucket_derived=bucket_derived,
    )
    failed_quality = [
        document
        for document in _mapping_rows(materialization_report.get("materialized_documents"))
        if str(
            (document.get("normalization_quality") or {}).get("quality_verdict")
            if isinstance(document.get("normalization_quality"), Mapping)
            else ""
        )
        != "passed"
    ]
    return {
        "schema_version": "historical-regulation-denominator-final-quality-audit.v1",
        "generated_at": generated_at,
        "phase": PHASE_ID,
        "selected_notice_ids": list(materialization_report.get("selected_notice_ids") or ()),
        "selected_target_document_ids": list(
            materialization_report.get("selected_target_document_ids") or ()
        ),
        "materialized_document_count": int(
            materialization_report.get("materialized_document_count") or 0
        ),
        "normalization_quality": {
            "verdict": "passed" if not failed_quality else "failed",
            "failed_or_flagged_document_count": len(failed_quality),
        },
        "chunk_preparation": {
            "overall_verdict": chunk_preparation_report.get("overall_verdict"),
            "prepared_document_count": chunk_preparation_report.get("prepared_document_count"),
            "total_chunk_count": chunk_preparation_report.get("total_chunk_count"),
            "failed_collections": list(chunk_preparation_report.get("failed_collections") or ()),
        },
        "object_store_key_audit": key_audit,
        "serving_closed": build_serving_closed_assertion(generated_at=generated_at),
        "candidate_store_noop": build_candidate_store_noop_assertion(generated_at=generated_at),
        "final_verdict": (
            "passed"
            if not failed_quality
            and str(chunk_preparation_report.get("overall_verdict") or "") == "passed"
            and int(key_audit["failed_key_count"]) == 0
            else "failed"
        ),
    }


def write_phase01_evidence_files(
    *,
    output_dir: Path,
    admission: Mapping[str, Any],
) -> dict[str, Path]:
    return write_mapping_files(
        output_dir=output_dir,
        payloads={
            "body-text-owner-admission-report.json": admission,
            "regulation-consumer-admission-manifest.json": admission["admission_manifest"],
            "regulation-candidate-audit.json": admission["candidate_audit"],
            "serving-closed-assertion.json": admission["serving_closed_assertion"],
            "candidate-store-noop-assertion.json": admission["candidate_store_noop_assertion"],
        },
    )


def write_mapping_files(
    *,
    output_dir: Path,
    payloads: Mapping[str, object],
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in sorted(payloads.items()):
        path = Path(output_dir) / filename
        _write_json(path, _jsonable(payload))
        written[filename] = path
    return written


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill historical regulation denominator expansion through canonical "
            "materialization and chunk-only quality evidence."
        )
    )
    parser.add_argument("--ready-candidates-path", default=str(DEFAULT_READY_CANDIDATES_PATH))
    parser.add_argument("--normalized-bundle-path", default=str(DEFAULT_NORMALIZED_BUNDLE_PATH))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--object-store-root",
        default="",
        help=(
            "Local filesystem object-store root. Defaults to <output-dir>/object-store "
            "while preserving bucket/key semantics."
        ),
    )
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    object_store_root = (
        Path(args.object_store_root) if args.object_store_root else output_dir / "object-store"
    )
    report = backfill_historical_regulation_denominator_expansion_from_paths(
        ready_candidates_path=Path(args.ready_candidates_path),
        normalized_bundle_path=Path(args.normalized_bundle_path),
        output_dir=output_dir,
        execute=bool(args.execute),
        object_store=LocalFilesystemObjectStore(object_store_root),
        env=os.environ,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _object_store_key_audit(
    *,
    admission: Mapping[str, Any],
    materialization_report: Mapping[str, Any],
    bucket_source: str,
    bucket_derived: str,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for entry in _mapping_rows(admission["admission_manifest"].get("entries")):
        recovery = entry.get("owner_text_recovery")
        refs = recovery.get("written_refs") if isinstance(recovery, Mapping) else {}
        if not isinstance(refs, Mapping):
            continue
        for ref in refs.values():
            if isinstance(ref, Mapping):
                rows.append(
                    _audit_object_key(
                        ref=ref,
                        expected_bucket=bucket_source,
                        key_regex=_SOURCE_KEY_RE,
                        expected_layer="source-truth",
                    )
                )
    for document in _mapping_rows(materialization_report.get("materialized_documents")):
        for field_name in ("canonical_markdown_object_key", "document_units_object_key"):
            key = str(document.get(field_name) or "").strip()
            if key:
                rows.append(
                    _audit_object_key(
                        ref={"bucket": bucket_derived, "key": key},
                        expected_bucket=bucket_derived,
                        key_regex=_DERIVED_KEY_RE,
                        expected_layer="derived-document",
                    )
                )
    return {
        "schema_version": "historical-regulation-object-store-key-audit.v1",
        "checked_key_count": len(rows),
        "failed_key_count": sum(1 for row in rows if row["verdict"] != "passed"),
        "records": rows,
    }


def _audit_object_key(
    *,
    ref: Mapping[str, Any],
    expected_bucket: str,
    key_regex: re.Pattern[str],
    expected_layer: str,
) -> dict[str, Any]:
    bucket = str(ref.get("bucket") or "").strip()
    key = str(ref.get("key") or "").strip()
    issues: list[str] = []
    if bucket != expected_bucket:
        issues.append("bucket_mismatch")
    if key_regex.match(key) is None:
        issues.append("key_contract_mismatch")
    return {
        "bucket": bucket,
        "key": key,
        "expected_layer": expected_layer,
        "issues": issues,
        "verdict": "passed" if not issues else "failed",
    }


def _default_env(env: Mapping[str, str] | None) -> dict[str, str]:
    source = dict(env or {})
    source.setdefault("OBJECT_STORE_ENDPOINT", "http://localhost:9000")
    source.setdefault("OBJECT_STORE_ACCESS_KEY", "local")
    source.setdefault("OBJECT_STORE_SECRET_KEY", "local")
    source.setdefault("OBJECT_STORE_BUCKET_SOURCE", DEFAULT_BUCKET_SOURCE)
    source.setdefault("OBJECT_STORE_BUCKET_DERIVED", DEFAULT_BUCKET_DERIVED)
    source.setdefault("EMBEDDING_MODEL", "Qwen3-Embedding-4B")
    return source


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = _load_json_any(path)
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _load_json_any(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _jsonable(value: object) -> object:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_jsonable(item) for item in value]
    return value


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


__all__ = [
    "DEFAULT_NORMALIZED_BUNDLE_PATH",
    "DEFAULT_OUTPUT_DIR",
    "DEFAULT_READY_CANDIDATES_PATH",
    "LocalFilesystemObjectStore",
    "backfill_historical_regulation_denominator_expansion_from_paths",
    "build_final_quality_audit",
    "build_parser",
    "main",
    "prepare_institutional_regulation_chunks",
    "prepare_scoped_rule_chunks",
    "write_phase01_evidence_files",
]


if __name__ == "__main__":
    main()
