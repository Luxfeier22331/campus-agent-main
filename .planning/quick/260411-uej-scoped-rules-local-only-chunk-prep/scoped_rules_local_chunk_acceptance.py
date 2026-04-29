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
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    prepare_scoped_rule_chunks,
)
from campus_ingestion_core.internal_notice_scoped_rule_materialization import (
    materialize_scoped_rules_from_internal_notice_scope,
)
from campus_ingestion_core.settings import ObjectStoreSettings


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ADJUDICATION_PATH = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260411-rho-institutional-regulations-promotion-adju"
    / "manual-review-adjudication.json"
)
DEFAULT_LOCAL_SMOKE_ROOT = (
    REPO_ROOT / ".tmp" / "historical-intake" / "run14-policy-regulation-expanded" / "local-smoke"
)
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent


class OverlayLocalSmokeObjectStore:
    def __init__(self, *, read_root: Path, write_root: Path) -> None:
        self._read_root = Path(read_root) / "object-store"
        self._write_root = Path(write_root) / "object-store"

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        write_path = self._write_root / bucket / Path(key)
        if write_path.exists():
            return write_path.read_bytes()
        return (self._read_root / bucket / Path(key)).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        target = self._write_root / bucket / Path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run local-only scoped_rules target chunk acceptance "
            "from historical authenticated-notice local-smoke artifacts."
        )
    )
    parser.add_argument("--adjudication-path", type=Path, default=DEFAULT_ADJUDICATION_PATH)
    parser.add_argument("--local-smoke-root", type=Path, default=DEFAULT_LOCAL_SMOKE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    adjudication_payload = _read_json(args.adjudication_path)
    notice_ids = [
        str(item["notice_id"])
        for item in adjudication_payload["adjudications"]
        if str(item.get("promotion_allowed_now")).lower() == "false"
    ]
    local_smoke_root = args.local_smoke_root.resolve()
    output_dir = args.output_dir.resolve()
    shutil.rmtree(output_dir / "overlay-object-store", ignore_errors=True)
    materialized_registry_path = output_dir / "scoped-rules-target-documents.json"
    rebuilt_inventory_path = output_dir / "rebuilt-source-truth-inventory.json"
    chunk_prep_dir = output_dir / "chunk-prep"

    document_registry = InMemoryDocumentRegistry.from_json_file(
        local_smoke_root / "registry" / "documents.json"
    )
    document_registry.backing_path = None
    raw_asset_registry = InMemoryRawAssetRegistry.from_json_file(
        local_smoke_root / "registry" / "raw-assets.json"
    )
    raw_asset_registry.backing_path = None

    object_store = OverlayLocalSmokeObjectStore(
        read_root=local_smoke_root,
        write_root=output_dir / "overlay-object-store",
    )
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
    rebuilt_inventory_path.write_text(
        json.dumps([asdict(entry) for entry in rebuilt_entries], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    materialization_report = materialize_scoped_rules_from_internal_notice_scope(
        request=InternalNoticeRegulationPromotionRequest(
            corpus="campus_notices",
            collection="internal_notice",
            notice_ids=tuple(notice_ids),
        ),
        env={
            "OBJECT_STORE_ENDPOINT": "http://local-smoke.invalid",
            "OBJECT_STORE_ACCESS_KEY": "local-smoke",
            "OBJECT_STORE_SECRET_KEY": "local-smoke",
            "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "EMBEDDING_PROVIDER": "mock",
            "EMBEDDING_MODEL": "mock-embedding-8d",
            "SPARSE_PROVIDER": "mock",
        },
        object_store=object_store,
        registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )

    target_records = document_registry.list_by_scope("regulations", "scoped_rules")
    materialized_registry_path.write_text(
        json.dumps(
            {
                f"{record.document_id}::{record.revision_track}::{record.version_id}": asdict(record)
                for record in target_records
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    shutil.rmtree(chunk_prep_dir, ignore_errors=True)
    chunk_prep_report = prepare_scoped_rule_chunks(
        records=target_records,
        object_store=object_store,
        output_dir=chunk_prep_dir,
    )
    validation_summary = _read_json(Path(chunk_prep_report.validation_summary_path))
    document_reports = _read_jsonl(Path(chunk_prep_report.document_reports_path))
    quality_posture = _quality_posture(validation_summary=validation_summary)
    summary_payload = {
        "schema_version": "scoped_rules_local_chunk_acceptance_v1",
        "local_only": True,
        "writes_postgres": False,
        "writes_qdrant": False,
        "writes_embeddings": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "notice_count": len(notice_ids),
        "notice_ids": notice_ids,
        "rebuilt_inventory_notice_count": len(rebuilt_entries),
        "materialized_document_count": materialization_report.materialized_document_count,
        "materialization_report": asdict(materialization_report),
        "quality_posture": quality_posture,
        "prepared_document_count": chunk_prep_report.prepared_document_count,
        "short_body_chunk_count": int(validation_summary["short_body_chunk_count"]),
        "failed_document_ids": list(validation_summary["failed_document_ids"]),
        "document_nature_counts": dict(materialization_report.document_nature_counts),
        "materialized_documents": [
            {
                "document_id": report["target_document_id"],
                "title": report["title"],
                "document_nature": report["document_nature"],
                "source_notice_ids": report["source_notice_ids"],
                "short_body_chunk_count": report["short_body_chunk_count"],
                "issues": report["issues"],
            }
            for report in document_reports
        ],
        "rebuilt_inventory_path": _relative_or_absolute(rebuilt_inventory_path),
        "target_registry_path": _relative_or_absolute(materialized_registry_path),
        "chunk_prep_manifest_path": _relative_or_absolute(Path(chunk_prep_report.manifest_path)),
        "chunk_prep_validation_summary_path": _relative_or_absolute(
            Path(chunk_prep_report.validation_summary_path)
        ),
        "chunk_prep_document_reports_path": _relative_or_absolute(
            Path(chunk_prep_report.document_reports_path)
        ),
        "validation_summary": validation_summary,
    }
    (output_dir / "scoped-rules-target-chunk-acceptance-summary.json").write_text(
        json.dumps(summary_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "scoped-rules-target-chunk-acceptance.md").write_text(
        _render_markdown_summary(summary_payload),
        encoding="utf-8",
    )


def _quality_posture(*, validation_summary: dict[str, Any]) -> str:
    if not bool(validation_summary["passed"]):
        return "needs_fix"
    return "ready_for_target_materialization"


def _render_markdown_summary(payload: dict[str, Any]) -> str:
    lines = [
        "# Scoped Rules Target Chunk Acceptance",
        "",
        "## Verdict",
        "",
        f"- quality posture: `{payload['quality_posture']}`",
        f"- adjudicated notice count: `{payload['notice_count']}`",
        f"- rebuilt inventory notice count: `{payload['rebuilt_inventory_notice_count']}`",
        f"- materialized scoped-rule document count: `{payload['materialized_document_count']}`",
        f"- prepared document count: `{payload['prepared_document_count']}`",
        f"- short body chunk count: `{payload['short_body_chunk_count']}`",
        f"- failed document ids: `{payload['failed_document_ids']}`",
        "",
        "## Materialized Documents",
        "",
    ]
    for item in payload["materialized_documents"]:
        lines.append(
            "- `{title}` -> `{nature}` | source_notice_ids=`{notice_ids}` | short_body_chunk_count=`{short_count}` | issues=`{issues}`".format(
                title=item["title"],
                nature=item["document_nature"],
                notice_ids=",".join(item["source_notice_ids"]) or "-",
                short_count=item["short_body_chunk_count"],
                issues=",".join(item["issues"]) or "-",
            )
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- local-only rebuilt inventory + scoped_rules materialization + target chunk prep",
            "- no Postgres writes",
            "- no Qdrant access",
            "- no embeddings",
            "- no release manifests",
            "- no alias publish",
            "",
            "## Artifacts",
            "",
            f"- `{payload['rebuilt_inventory_path']}`",
            f"- `{payload['target_registry_path']}`",
            f"- `{payload['chunk_prep_manifest_path']}`",
            f"- `{payload['chunk_prep_validation_summary_path']}`",
            f"- `{payload['chunk_prep_document_reports_path']}`",
        ]
    )
    return "\n".join(lines) + "\n"


def _read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _relative_or_absolute(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
