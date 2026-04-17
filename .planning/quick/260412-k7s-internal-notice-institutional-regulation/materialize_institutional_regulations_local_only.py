from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import shutil

import campus_ingestion_core.raw_ingestion as _raw_ingestion  # Ensure package init settles in script mode.
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_regulation_materialization import (
    materialize_institutional_regulations_from_internal_notice_scope,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.registry import (
    _document_record_from_dict,
    _raw_asset_record_from_dict,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_LOCAL_SMOKE_ROOT = (
    REPO_ROOT / ".tmp" / "historical-intake" / "run14-policy-regulation-expanded" / "local-smoke"
)
DEFAULT_ACCEPTANCE_SUMMARY = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260412-jre-institutional-regulations-target-collect"
    / "rerun-output"
    / "cohort-a-target-chunk-acceptance-summary.json"
)
DEFAULT_REBUILT_INVENTORY = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260412-jre-institutional-regulations-target-collect"
    / "rerun-output"
    / "cohort-a-rebuilt-source-truth-inventory.json"
)
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "materialization-output"


class OverlayObjectStore:
    def __init__(self, *, read_root: Path, write_root: Path) -> None:
        self._read_root = Path(read_root)
        self._write_root = Path(write_root)
        self.writes: list[dict[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        overlay_path = self._write_root / bucket / Path(key)
        if overlay_path.exists():
            return overlay_path.read_bytes()
        return (self._read_root / bucket / Path(key)).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        target = self._write_root / bucket / Path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        self.writes.append(
            {
                "bucket": bucket,
                "key": key,
                "content_type": content_type,
                "path": str(target.relative_to(REPO_ROOT)),
            }
        )


def main() -> None:
    local_smoke_root = DEFAULT_LOCAL_SMOKE_ROOT.resolve()
    acceptance_summary = _read_json(DEFAULT_ACCEPTANCE_SUMMARY)
    rebuilt_inventory_rows = _read_json(DEFAULT_REBUILT_INVENTORY)
    output_dir = DEFAULT_OUTPUT_DIR.resolve()
    registry_dir = output_dir / "registry"
    overlay_root = output_dir / "object-store"

    shutil.rmtree(output_dir, ignore_errors=True)
    registry_dir.mkdir(parents=True, exist_ok=True)

    document_registry = InMemoryDocumentRegistry(
        _load_document_records(local_smoke_root / "registry" / "documents.json"),
        backing_path=registry_dir / "documents.json",
    )
    raw_asset_registry = InMemoryRawAssetRegistry(
        _load_raw_asset_records(local_smoke_root / "registry" / "raw-assets.json"),
        backing_path=registry_dir / "raw-assets.json",
    )
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(
        tuple(
            AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row))
            for row in rebuilt_inventory_rows
        )
    )
    object_store = OverlayObjectStore(
        read_root=local_smoke_root / "object-store",
        write_root=overlay_root,
    )

    request = InternalNoticeRegulationPromotionRequest(
        corpus="campus_notices",
        collection="internal_notice",
        notice_ids=tuple(acceptance_summary["cohort_notice_ids"]),
    )
    report = materialize_institutional_regulations_from_internal_notice_scope(
        request=request,
        env={
            "OBJECT_STORE_ENDPOINT": "http://local-only.invalid",
            "OBJECT_STORE_ACCESS_KEY": "local-only",
            "OBJECT_STORE_SECRET_KEY": "local-only",
            "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
        },
        object_store=object_store,
        registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )

    target_records = list(document_registry.list_by_scope("regulations", "institutional_regulations"))
    target_payload = [asdict(record) for record in target_records]
    target_titles = [
        _extract_title(
            object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key,
            ).decode("utf-8")
        )
        for record in target_records
    ]
    target_titles_sorted = sorted(target_titles)
    written_keys = sorted(object_store.writes, key=lambda item: item["path"])
    materialized_notice_ids = sorted(report.source_notice_ids)
    manual_review_notice_ids = sorted(
        item["notice_id"] for item in acceptance_summary["manual_review_notices"]
    )

    summary_payload = {
        "schema_version": "internal_notice_institutional_regulation_local_materialization_v1",
        "local_only": True,
        "writes_postgres": False,
        "writes_qdrant": False,
        "writes_embeddings": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "source_local_smoke_root": _relative_or_absolute(local_smoke_root),
        "source_acceptance_summary_path": _relative_or_absolute(DEFAULT_ACCEPTANCE_SUMMARY),
        "source_rebuilt_inventory_path": _relative_or_absolute(DEFAULT_REBUILT_INVENTORY),
        "output_dir": _relative_or_absolute(output_dir),
        "promotion_candidate_count": report.promotion_candidate_count,
        "materialized_document_count": report.materialized_document_count,
        "created_document_ids": list(report.created_document_ids),
        "updated_document_ids": list(report.updated_document_ids),
        "source_notice_ids": list(report.source_notice_ids),
        "source_document_ids": list(report.source_document_ids),
        "raw_asset_id": report.raw_asset_id,
        "raw_version_id": report.raw_version_id,
        "target_titles": target_titles_sorted,
        "target_record_count": len(target_payload),
        "materialized_notice_ids": materialized_notice_ids,
        "manual_review_notice_ids": manual_review_notice_ids,
        "manual_review_not_materialized": all(
            notice_id not in materialized_notice_ids for notice_id in manual_review_notice_ids
        ),
        "registry_documents_path": _relative_or_absolute(registry_dir / "documents.json"),
        "registry_raw_assets_path": _relative_or_absolute(registry_dir / "raw-assets.json"),
        "target_scope_records_path": _relative_or_absolute(output_dir / "target-scope-records.json"),
        "object_store_write_manifest_path": _relative_or_absolute(output_dir / "object-store-write-manifest.json"),
    }

    if report.promotion_candidate_count != 10:
        raise SystemExit(f"expected 10 promotion candidates, got {report.promotion_candidate_count}")
    if report.materialized_document_count != 10:
        raise SystemExit(
            f"expected 10 materialized documents, got {report.materialized_document_count}"
        )
    if len(target_payload) != 10:
        raise SystemExit(f"expected 10 target scope records, got {len(target_payload)}")
    if not summary_payload["manual_review_not_materialized"]:
        raise SystemExit("manual-review notices leaked into institutional_regulations target scope")

    (output_dir / "target-scope-records.json").write_text(
        json.dumps(target_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "object-store-write-manifest.json").write_text(
        json.dumps(written_keys, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "materialization-report.json").write_text(
        json.dumps(summary_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "materialization-summary.md").write_text(
        _render_summary(summary_payload),
        encoding="utf-8",
    )


def _load_document_records(path: Path) -> tuple:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return tuple(_document_record_from_dict(raw) for raw in payload.values())


def _load_raw_asset_records(path: Path) -> tuple:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return tuple(_raw_asset_record_from_dict(raw) for raw in payload.values())


def _extract_title(markdown_text: str) -> str:
    for line in markdown_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return markdown_text.strip().splitlines()[0].strip()


def _render_summary(payload: dict[str, object]) -> str:
    target_titles = payload["target_titles"]
    assert isinstance(target_titles, list)
    lines = [
        "# Institutional Regulations Local-only Materialization",
        "",
        "## Verdict",
        "",
        f"- promotion candidate count: `{payload['promotion_candidate_count']}`",
        f"- materialized document count: `{payload['materialized_document_count']}`",
        f"- target record count: `{payload['target_record_count']}`",
        f"- manual review notices leaked: `{not payload['manual_review_not_materialized']}`",
        "",
        "## Materialized Titles",
        "",
    ]
    for title in target_titles:
        lines.append(f"- {title}")
    manual_review_notice_ids = payload["manual_review_notice_ids"]
    assert isinstance(manual_review_notice_ids, list)
    lines.extend(["", "## Excluded Manual Review Notices", ""])
    if manual_review_notice_ids:
        for notice_id in manual_review_notice_ids:
            lines.append(f"- `{notice_id}`")
    else:
        lines.append("- none")
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- reads from existing local-smoke source snapshot",
            "- writes target registry/object-store artifacts only into this quick task directory",
            "- no Postgres writes",
            "- no Qdrant writes",
            "- no embeddings",
            "- no release or alias publish",
        ]
    )
    return "\n".join(lines) + "\n"


def _read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def _relative_or_absolute(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
