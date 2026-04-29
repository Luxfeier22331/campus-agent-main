from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionRequest,
    rebuild_authenticated_notice_source_projections,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_document_id,
)
from campus_ingestion_core.internal_notice_regulation_materialization import (
    materialize_institutional_regulations_from_internal_notice_scope,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.registry import (
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_worker.env_bootstrap import load_worker_env


REPO_ROOT = Path(__file__).resolve().parents[3]
QUICK_DIR = REPO_ROOT / ".planning" / "quick" / "260414-8rt-regulation-replay-rematerialization"
OUTPUT_DIR = QUICK_DIR / "run-output"
ISOLATED_SOURCE_ROOT = (
    REPO_ROOT / ".planning" / "quick" / "260414-regulation-owner-recovery-pilot" / "run-output-fixed"
)
COHORT_A_SUMMARY_PATH = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260412-jre-institutional-regulations-target-collect"
    / "rerun-output"
    / "cohort-a-target-chunk-acceptance-summary.json"
)


class LocalDirObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        del content_type
        path = self.root / bucket / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def _normalize(value: Any) -> Any:
    if is_dataclass(value):
        return {key: _normalize(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    return value


def _extract_markdown_title(markdown_text: str) -> str:
    for line in markdown_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return ""


def _load_document_units_payload(file_bytes: bytes) -> dict[str, Any]:
    first_line = file_bytes.decode("utf-8").splitlines()[0]
    return json.loads(first_line)


def _load_cohort_notice_ids() -> tuple[str, ...]:
    payload = json.loads(COHORT_A_SUMMARY_PATH.read_text(encoding="utf-8"))
    return tuple(payload["cohort_notice_ids"])


def _load_current_target_snapshot(*, env: dict[str, str]) -> list[dict[str, Any]]:
    registry = build_document_registry_from_env(env)
    object_store_settings = ObjectStoreSettings.from_env(env)
    object_store = S3ObjectStoreWriter(object_store_settings)
    records = registry.list_by_scope("regulations", "institutional_regulations")
    snapshot: list[dict[str, Any]] = []
    for record in records:
        metadata: dict[str, Any] = {}
        title = None
        if record.document_units_object_key:
            payload = _load_document_units_payload(
                object_store.get_bytes(
                    bucket=object_store_settings.bucket_derived,
                    key=record.document_units_object_key,
                )
            )
            metadata = dict(payload.get("metadata") or {})
            title = metadata.get("title")
        snapshot.append(
            {
                "document_id": record.document_id,
                "version_id": record.version_id,
                "title": title,
                "source_document_id": metadata.get("source_document_id"),
                "source_notice_ids": metadata.get("source_notice_ids"),
                "regulation_work_title": metadata.get("regulation_work_title"),
                "regulation_edition_label": metadata.get("regulation_edition_label"),
                "regulation_display_title": metadata.get("regulation_display_title"),
            }
        )
    return sorted(snapshot, key=lambda item: item["document_id"])


def _run_355282_isolated_sample() -> dict[str, Any]:
    base_dir = OUTPUT_DIR / "355282-isolated"
    object_store_root = base_dir / "object-store"
    source_root = ISOLATED_SOURCE_ROOT
    filtered_bundle_path = source_root / "filtered-notices-bundle.json"
    base_dir.mkdir(parents=True, exist_ok=True)

    object_store = LocalDirObjectStore(object_store_root)
    for source_path in (source_root / "object-store").rglob("*"):
        if not source_path.is_file():
            continue
        target_path = object_store_root / source_path.relative_to(source_root / "object-store")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(source_path.read_bytes())

    from campus_ingestion_core.in_memory_registries import (
        InMemoryDocumentRegistry,
        InMemoryRawAssetRegistry,
    )

    document_registry = InMemoryDocumentRegistry(base_dir / "registry" / "documents.json")
    raw_asset_registry = InMemoryRawAssetRegistry(base_dir / "registry" / "raw-assets.json")
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()

    env = {
        "OBJECT_STORE_ENDPOINT": "http://example.invalid",
        "OBJECT_STORE_ACCESS_KEY": "dummy",
        "OBJECT_STORE_SECRET_KEY": "dummy",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
    }

    import_result = import_authenticated_notice_export(
        request=AuthenticatedNoticeImportRequest(
            bundle_path=filtered_bundle_path,
            export_manifest_path=None,
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            corpus="campus_notices",
            collection="internal_notice",
            default_entitlement_groups=("campus_members",),
            visibility_scope="campus",
        ),
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )
    projection_report = rebuild_authenticated_notice_source_projections(
        request=AuthenticatedNoticeSourceProjectionRequest(
            corpus="campus_notices",
            collection="internal_notice",
        ),
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
    )
    materialization_report = materialize_institutional_regulations_from_internal_notice_scope(
        request=InternalNoticeRegulationPromotionRequest(notice_ids=("355282",)),
        env=env,
        object_store=object_store,
        registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )

    target_records = document_registry.list_by_scope("regulations", "institutional_regulations")
    if len(target_records) != 1:
        raise SystemExit(f"expected 1 isolated target record for 355282, got {len(target_records)}")
    target_record = target_records[0]
    canonical_markdown = object_store.get_bytes(
        bucket="campus-rag-derived",
        key=target_record.canonical_markdown_object_key,
    ).decode("utf-8")
    document_units_payload = _load_document_units_payload(
        object_store.get_bytes(
            bucket="campus-rag-derived",
            key=target_record.document_units_object_key,
        )
    )
    metadata = dict(document_units_payload.get("metadata") or {})
    title = metadata.get("title")
    expected_document_id = build_institutional_regulation_document_id(
        regulation_title_normalized=str(metadata.get("regulation_title_normalized") or ""),
        regulation_work_title=(
            str(metadata.get("regulation_work_title"))
            if metadata.get("regulation_work_title") is not None
            else None
        ),
        issuing_org=str(metadata.get("issuing_org") or "中央民族大学"),
    )
    return {
        "import_result": _normalize(import_result),
        "projection_report": _normalize(projection_report),
        "materialization_report": _normalize(materialization_report),
        "target_document_id": target_record.document_id,
        "expected_document_id": expected_document_id,
        "target_title": title,
        "canonical_heading": _extract_markdown_title(canonical_markdown),
        "metadata": {
            "regulation_work_title": metadata.get("regulation_work_title"),
            "regulation_edition_label": metadata.get("regulation_edition_label"),
            "regulation_display_title": metadata.get("regulation_display_title"),
            "source_title_literal": metadata.get("source_title_literal"),
            "source_notice_release_time": metadata.get("source_notice_release_time"),
            "effective_date": metadata.get("effective_date"),
            "semantic_owner_kind": metadata.get("semantic_owner_kind"),
        },
    }


def _run_formal_local_refresh() -> dict[str, Any]:
    load_worker_env()
    env = dict(__import__("os").environ)
    before_snapshot = _load_current_target_snapshot(env=env)
    notice_ids = _load_cohort_notice_ids()
    report = materialize_institutional_regulations_from_internal_notice_scope(
        request=InternalNoticeRegulationPromotionRequest(
            corpus="campus_notices",
            collection="internal_notice",
            notice_ids=notice_ids,
        ),
        env=env,
        registry=build_document_registry_from_env(env),
        raw_asset_registry=build_raw_asset_registry_from_env(env),
    )
    after_snapshot = _load_current_target_snapshot(env=env)
    return {
        "cohort_notice_ids": list(notice_ids),
        "before_target_count": len(before_snapshot),
        "after_target_count": len(after_snapshot),
        "before_snapshot": before_snapshot,
        "after_snapshot": after_snapshot,
        "materialization_report": _normalize(report),
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    isolated = _run_355282_isolated_sample()
    formal = _run_formal_local_refresh()
    payload = {
        "schema_version": "regulation_replay_rematerialization_v1",
        "writes_embeddings": False,
        "writes_qdrant": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "isolated_355282": isolated,
        "formal_local_refresh": formal,
    }

    if isolated["target_document_id"] != isolated["expected_document_id"]:
        raise SystemExit("355282 isolated sample did not use work-title-driven document_id")
    if isolated["target_title"] != "中央民族大学关于学生使用人工智能的指导意见 / 2026版":
        raise SystemExit("355282 isolated sample did not use display title")
    if isolated["canonical_heading"] != "中央民族大学关于学生使用人工智能的指导意见（2026版）":
        raise SystemExit("355282 canonical heading drifted away from source-facing title")

    formal_report = formal["materialization_report"]
    if formal_report["promotion_candidate_count"] != 10:
        raise SystemExit("formal local refresh expected 10 promotion candidates")
    if formal_report["materialized_document_count"] != 10:
        raise SystemExit("formal local refresh expected 10 materialized documents")
    if formal["after_target_count"] != 10:
        raise SystemExit("formal local refresh expected 10 target rows")

    after_titles = {row["title"] for row in formal["after_snapshot"]}
    expected_titles = {
        "中央民族大学采购工作管理办法",
        "中央民族大学丰台校区就医管理办法（暂行）",
        "中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则",
        "中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则",
        "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则",
        "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
        "历史文化学院2021年硕博连读博士研究生 招生实施细则",
        "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
        "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
        "药学院2021年硕博连读博士研究生招生实施细则",
    }
    if after_titles != expected_titles:
        raise SystemExit("formal local refresh target titles drifted from accepted Cohort A set")

    (OUTPUT_DIR / "replay-summary.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
