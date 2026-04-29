from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import shutil
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_entries,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_regulation_candidate_chunk_prep import (
    prepare_internal_notice_regulation_candidate_chunks,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_candidate_artifact_manifest,
    build_internal_notice_regulation_promotion_manifest,
    export_internal_notice_regulation_candidate_artifacts,
)
from campus_ingestion_core.settings import ObjectStoreSettings


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_COHORT_MANIFEST = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260410-5yl-internal-notice-policy-regulation-cohort"
    / "run14-policy-regulation-cohorts.json"
)
DEFAULT_LOCAL_SMOKE_ROOT = (
    REPO_ROOT / ".tmp" / "historical-intake" / "run14-policy-regulation-expanded" / "local-smoke"
)
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent


class LocalSmokeObjectStore:
    def __init__(self, local_smoke_root: Path) -> None:
        self._root = Path(local_smoke_root) / "object-store"

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self._root / bucket / Path(key)).read_bytes()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run Cohort A local-only target chunk acceptance for "
            "regulations/institutional_regulations."
        )
    )
    parser.add_argument("--cohort-manifest", type=Path, default=DEFAULT_COHORT_MANIFEST)
    parser.add_argument("--local-smoke-root", type=Path, default=DEFAULT_LOCAL_SMOKE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cohort_manifest = _read_json(args.cohort_manifest)
    notice_ids = list(cohort_manifest["cohorts"]["A"]["notice_ids"])
    local_smoke_root = args.local_smoke_root.resolve()
    output_dir = args.output_dir.resolve()

    document_registry = InMemoryDocumentRegistry.from_json_file(
        local_smoke_root / "registry" / "documents.json"
    )
    raw_asset_registry = InMemoryRawAssetRegistry.from_json_file(
        local_smoke_root / "registry" / "raw-assets.json"
    )
    object_store = LocalSmokeObjectStore(local_smoke_root)
    object_store_settings = ObjectStoreSettings(
        endpoint="http://local-smoke.invalid",
        access_key="local-smoke",
        secret_key="local-smoke",
    )

    rebuilt_entries = build_authenticated_notice_source_truth_inventory_entries(
        corpus="campus_notices",
        collection="internal_notice",
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store=object_store,
        object_store_settings=object_store_settings,
        notice_ids=tuple(notice_ids),
    )
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(rebuilt_entries)

    rebuilt_inventory_path = output_dir / "cohort-a-rebuilt-source-truth-inventory.json"
    rebuilt_inventory_path.write_text(
        json.dumps([asdict(entry) for entry in rebuilt_entries], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    candidate_export_dir = output_dir / "cohort-a-candidate-export-rebuilt"
    chunk_prep_dir = output_dir / "cohort-a-chunk-prep-rebuilt"
    shutil.rmtree(candidate_export_dir, ignore_errors=True)
    shutil.rmtree(chunk_prep_dir, ignore_errors=True)

    request = InternalNoticeRegulationPromotionRequest(
        corpus="campus_notices",
        collection="internal_notice",
        notice_ids=tuple(notice_ids),
    )
    candidate_manifest, candidate_documents = build_internal_notice_regulation_candidate_artifact_manifest(
        request=request,
        registry=document_registry,
        source_truth_inventory_store=inventory_store,
        object_store=object_store,
    )
    promotion_report = build_internal_notice_regulation_promotion_manifest(
        request=request,
        registry=document_registry,
        source_truth_inventory_store=inventory_store,
        object_store=object_store,
    )
    candidate_manifest_path, candidate_documents_path = (
        export_internal_notice_regulation_candidate_artifacts(
            output_dir=candidate_export_dir,
            manifest=candidate_manifest,
            documents=candidate_documents,
        )
    )
    chunk_report = prepare_internal_notice_regulation_candidate_chunks(
        documents=candidate_documents,
        output_dir=chunk_prep_dir,
    )

    validation_summary = _read_json(Path(chunk_report.validation_summary_path))
    document_reports = _read_jsonl(Path(chunk_report.document_reports_path))
    short_body_by_candidate = {
        str(item["candidate_id"]): int(item["short_body_chunk_count"])
        for item in document_reports
    }
    short_body_by_notice = {
        str(item["source_document_id"]).split(":")[-1]: int(item["short_body_chunk_count"])
        for item in document_reports
    }
    quality_posture = _quality_posture(validation_summary=validation_summary)
    summary_payload = {
        "schema_version": "institutional_regulations_cohort_a_target_chunk_acceptance_v1",
        "batch_id": str(cohort_manifest["batch_id"]),
        "cohort": "A",
        "cohort_label": str(cohort_manifest["cohorts"]["A"]["label"]),
        "local_only": True,
        "writes_postgres": False,
        "writes_qdrant": False,
        "writes_embeddings": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "cohort_notice_count": len(notice_ids),
        "cohort_notice_ids": notice_ids,
        "rebuilt_inventory_notice_count": len(rebuilt_entries),
        "promotion_candidate_count": promotion_report.candidate_count,
        "promotion_manual_review_count": promotion_report.manual_review_count,
        "promotion_hold_count": promotion_report.hold_count,
        "promotion_action_counts": dict(promotion_report.action_counts),
        "candidate_exported_count": candidate_manifest.exported_candidate_count,
        "prepared_candidate_count": chunk_report.prepared_candidate_count,
        "quality_posture": quality_posture,
        "short_body_chunk_count": int(validation_summary["short_body_chunk_count"]),
        "failed_candidate_ids": list(validation_summary["failed_candidate_ids"]),
        "short_body_by_candidate_id": short_body_by_candidate,
        "short_body_by_notice_id": short_body_by_notice,
        "manual_review_notices": [
            {
                "notice_id": report.notice_id,
                "promotion_class": report.promotion_class,
                "missing_required_metadata": list(report.missing_required_metadata),
                "reasons": list(report.reasons),
            }
            for report in promotion_report.documents
            if report.action == "manual_review_required"
        ],
        "rebuilt_inventory_path": _relative_or_absolute(rebuilt_inventory_path),
        "candidate_manifest_path": _relative_or_absolute(candidate_manifest_path),
        "candidate_documents_path": _relative_or_absolute(candidate_documents_path),
        "chunk_prep_manifest_path": _relative_or_absolute(Path(chunk_report.manifest_path)),
        "chunk_prep_validation_summary_path": _relative_or_absolute(
            Path(chunk_report.validation_summary_path)
        ),
        "chunk_prep_document_reports_path": _relative_or_absolute(
            Path(chunk_report.document_reports_path)
        ),
        "validation_summary": validation_summary,
    }
    (output_dir / "cohort-a-target-chunk-acceptance-summary.json").write_text(
        json.dumps(summary_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "cohort-a-target-chunk-acceptance.md").write_text(
        _render_markdown_summary(summary_payload),
        encoding="utf-8",
    )


def _quality_posture(*, validation_summary: dict[str, Any]) -> str:
    if not bool(validation_summary["passed"]):
        return "needs_fix"
    if int(validation_summary["short_body_chunk_count"]) > 0:
        return "needs_short_fragment_tuning_review"
    return "ready_for_target_materialization"


def _render_markdown_summary(payload: dict[str, Any]) -> str:
    lines = [
        "# Cohort A Target Chunk Acceptance",
        "",
        "## Verdict",
        "",
        f"- quality posture: `{payload['quality_posture']}`",
        f"- cohort notice count: `{payload['cohort_notice_count']}`",
        f"- rebuilt inventory notice count: `{payload['rebuilt_inventory_notice_count']}`",
        f"- promotion candidate count: `{payload['promotion_candidate_count']}`",
        f"- promotion manual review count: `{payload['promotion_manual_review_count']}`",
        f"- exported candidate count: `{payload['candidate_exported_count']}`",
        f"- prepared candidate count: `{payload['prepared_candidate_count']}`",
        f"- short body chunk count: `{payload['short_body_chunk_count']}`",
        f"- failed candidate ids: `{payload['failed_candidate_ids']}`",
        "",
        "## Targeted Observations",
        "",
    ]
    short_body_by_notice = dict(payload["short_body_by_notice_id"])
    if short_body_by_notice:
        for notice_id, count in sorted(short_body_by_notice.items()):
            lines.append(f"- `{notice_id}` short_body_chunk_count = `{count}`")
    else:
        lines.append("- no short-body fragments observed")
    lines.extend(["", "## Manual Review Notices", ""])
    manual_review_notices = list(payload["manual_review_notices"])
    if manual_review_notices:
        for item in manual_review_notices:
            lines.append(
                "- `{notice_id}` -> `{promotion_class}` | missing=`{missing}` | reasons=`{reasons}`".format(
                    notice_id=item["notice_id"],
                    promotion_class=item["promotion_class"],
                    missing=",".join(item["missing_required_metadata"]) or "-",
                    reasons=",".join(item["reasons"]) or "-",
                )
            )
    else:
        lines.append("- none")
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- local-only rebuilt inventory + candidate export + target chunk prep",
            "- no Postgres writes",
            "- no Qdrant access",
            "- no embeddings",
            "- no release manifest",
            "- no alias publish",
            "",
            "## Artifacts",
            "",
            f"- `{payload['rebuilt_inventory_path']}`",
            f"- `{payload['candidate_manifest_path']}`",
            f"- `{payload['candidate_documents_path']}`",
            f"- `{payload['chunk_prep_manifest_path']}`",
            f"- `{payload['chunk_prep_validation_summary_path']}`",
            f"- `{payload['chunk_prep_document_reports_path']}`",
        ]
    )
    return "\n".join(lines) + "\n"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        normalized = line.strip()
        if normalized:
            rows.append(json.loads(normalized))
    return rows


def _relative_or_absolute(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
