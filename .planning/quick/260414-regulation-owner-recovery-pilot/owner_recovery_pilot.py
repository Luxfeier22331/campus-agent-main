from __future__ import annotations

import argparse
from dataclasses import asdict, is_dataclass
import json
from pathlib import Path
from typing import Any

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
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_promotion_manifest,
)


DEFAULT_BUNDLE_PATH = Path(".tmp/auth-sso-tgc-20260412/exports/notices-bundle-20260411T222916.520Z.json")
DEFAULT_ATTACHMENT_SOURCE_ROOTS = (
    Path(".tmp/acceptance/policy-anchor-replay-20260409/local-smoke/object-store/campus-rag-source"),
    Path(".tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/object-store/campus-rag-source"),
    Path(".tmp/historical-intake/run14-policy-regulation-core/local-smoke/object-store/campus-rag-source"),
)
DEFAULT_CURRENT_SCOPE_REPORTS_PATH = Path(
    ".planning/quick/260414-regulation-cohort-b-discovery/run-output-after-parent-title-signal/document-reports.jsonl"
)
DEFAULT_NOTICE_IDS = ("355282", "351119")


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run isolated owner-recovery pilot for attachment/file-release backed regulation notices."
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--bundle-path", default=str(DEFAULT_BUNDLE_PATH))
    parser.add_argument("--current-scope-reports-path", default=str(DEFAULT_CURRENT_SCOPE_REPORTS_PATH))
    parser.add_argument("--notice-id", action="append", default=list(DEFAULT_NOTICE_IDS))
    parser.add_argument(
        "--attachment-source-root",
        action="append",
        default=[str(path) for path in DEFAULT_ATTACHMENT_SOURCE_ROOTS],
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    requested_notice_ids = tuple(
        sorted({str(item).strip() for item in args.notice_id if str(item).strip()})
    )
    bundle_path = Path(args.bundle_path).resolve()
    bundle_rows = json.loads(bundle_path.read_text(encoding="utf-8"))
    if not isinstance(bundle_rows, list):
        raise ValueError("bundle rows must be a JSON array")

    available_rows = {
        str(row.get("notice_id")): row
        for row in bundle_rows
        if str(row.get("notice_id") or "").strip() in requested_notice_ids
    }
    attachment_source_roots = tuple(Path(item).resolve() for item in args.attachment_source_root)
    current_scope_reports = _load_current_scope_reports(Path(args.current_scope_reports_path).resolve())

    store = LocalDirObjectStore(output_dir / "object-store")
    document_registry = InMemoryDocumentRegistry(output_dir / "registry" / "documents.json")
    raw_asset_registry = InMemoryRawAssetRegistry(output_dir / "registry" / "raw-assets.json")
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()

    seeded_attachments: list[dict[str, Any]] = []
    seeded_notice_ids: list[str] = []
    blocked_notices: list[dict[str, Any]] = []
    for notice_id in requested_notice_ids:
        row = available_rows.get(notice_id)
        if row is None:
            blocked_notices.append(
                {
                    "notice_id": notice_id,
                    "status": "blocked",
                    "reason": "notice_bundle_missing_in_local_inputs",
                    "current_scope_report": current_scope_reports.get(notice_id),
                }
            )
            continue
        seeded_notice_ids.append(notice_id)
        for attachment in row.get("attachments") or ():
            if str(attachment.get("storage_provider") or "") != "object_store":
                continue
            source_file = _locate_attachment_source_file(
                attachment=attachment,
                attachment_source_roots=attachment_source_roots,
            )
            if source_file is None:
                blocked_notices.append(
                    {
                        "notice_id": notice_id,
                        "status": "blocked",
                        "reason": "attachment_bytes_missing_in_local_roots",
                        "attachment": _compact_attachment_payload(attachment),
                    }
                )
                continue
            payload = source_file.read_bytes()
            store.put_bytes(
                bucket=str(attachment["bucket"]),
                key=str(attachment["object_key"]),
                data=payload,
                content_type=str(attachment.get("mime_type") or "application/octet-stream"),
            )
            seeded_attachments.append(
                {
                    "notice_id": notice_id,
                    "object_key": str(attachment["object_key"]),
                    "sha256": str(attachment.get("sha256") or ""),
                    "source_file": str(source_file),
                }
            )

    filtered_rows = [available_rows[notice_id] for notice_id in seeded_notice_ids if notice_id in available_rows]
    filtered_bundle_path = output_dir / "filtered-notices-bundle.json"
    filtered_bundle_path.write_text(
        json.dumps(filtered_rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    env = {
        "OBJECT_STORE_ENDPOINT": "http://example.invalid",
        "OBJECT_STORE_ACCESS_KEY": "dummy",
        "OBJECT_STORE_SECRET_KEY": "dummy",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
    }

    import_result: dict[str, Any] | None = None
    projection_report: dict[str, Any] | None = None
    promotion_manifest: dict[str, Any] | None = None
    projected_document_ids: list[str] = []
    promoted_documents: list[dict[str, Any]] = []

    if filtered_rows:
        request = AuthenticatedNoticeImportRequest(
            bundle_path=filtered_bundle_path,
            export_manifest_path=None,
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            corpus="campus_notices",
            collection="internal_notice",
            default_entitlement_groups=("campus_members",),
            visibility_scope="campus",
        )
        import_result = import_authenticated_notice_export(
            request=request,
            env=env,
            object_store=store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
        )
        projection = rebuild_authenticated_notice_source_projections(
            request=AuthenticatedNoticeSourceProjectionRequest(
                corpus="campus_notices",
                collection="internal_notice",
            ),
            env=env,
            object_store=store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
        )
        projection_report = _normalize_dataclass_or_dict(projection)
        projected_document_ids = [
            record.document_id
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
        ]
        manifest = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(notice_ids=tuple(seeded_notice_ids)),
            env=env,
            registry=document_registry,
            source_truth_inventory_store=inventory_store,
            object_store=store,
        )
        promotion_manifest = _normalize_dataclass_or_dict(manifest)
        for report in promotion_manifest.get("documents") or ():
            if str(report.get("action") or "") == "promote_candidate":
                promoted_documents.append(
                    {
                        "notice_id": str(report.get("notice_id") or ""),
                        "document_id": str(report.get("document_id") or ""),
                        "source_kind": str(report.get("source_kind") or ""),
                        "source_title": str(report.get("source_title") or ""),
                        "regulation_title_normalized": report.get("regulation_title_normalized"),
                        "semantic_owner_kind": str(report.get("semantic_owner_kind") or ""),
                    }
                )

    summary = {
        "requested_notice_ids": requested_notice_ids,
        "bundle_path": str(bundle_path),
        "filtered_bundle_path": str(filtered_bundle_path),
        "seeded_notice_ids": seeded_notice_ids,
        "seeded_attachment_count": len(seeded_attachments),
        "seeded_attachments": seeded_attachments,
        "blocked_notices": blocked_notices,
        "projected_document_ids": projected_document_ids,
        "promoted_documents": promoted_documents,
        "import_result": import_result,
        "projection_report": projection_report,
        "promotion_manifest": promotion_manifest,
    }
    (output_dir / "owner-recovery-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _normalize_dataclass_or_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if is_dataclass(value):
        return asdict(value)
    raise TypeError("expected dataclass or dict payload")


def _compact_attachment_payload(attachment: dict[str, Any]) -> dict[str, Any]:
    return {
        "original_filename": attachment.get("original_filename"),
        "sha256": attachment.get("sha256"),
        "object_key": attachment.get("object_key"),
    }


def _load_current_scope_reports(path: Path) -> dict[str, dict[str, Any]]:
    reports: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return reports
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        notice_id = str(payload.get("notice_id") or "").strip()
        if notice_id:
            reports[notice_id] = {
                "action": payload.get("action"),
                "promotion_class": payload.get("promotion_class"),
                "owner_source_missing_reason": payload.get("owner_source_missing_reason"),
                "semantic_owner_kind": payload.get("semantic_owner_kind"),
                "reasons": payload.get("reasons"),
            }
    return reports


def _locate_attachment_source_file(
    *,
    attachment: dict[str, Any],
    attachment_source_roots: tuple[Path, ...],
) -> Path | None:
    filename = Path(str(attachment.get("original_filename") or "")).name
    sha256 = str(attachment.get("sha256") or "").strip().lower()
    object_key = str(attachment.get("object_key") or "").strip()
    candidates: list[Path] = []
    for root in attachment_source_roots:
        if object_key:
            candidates.append(root / object_key)
        if sha256 and filename:
            candidates.append(root / sha256[:2] / sha256 / filename)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


if __name__ == "__main__":
    main()
