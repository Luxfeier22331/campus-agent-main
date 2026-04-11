from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_promotion_manifest,
    extract_internal_notice_parent_regulation_body_preview,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
QUICK_DIR = Path(__file__).resolve().parent
LOCAL_SMOKE_ROOT = REPO_ROOT / ".tmp" / "historical-intake" / "run14-policy-regulation-expanded" / "local-smoke"
NOTICE_ID = "187233"
SOURCE_TITLE = "关于修订《中央民族大学采购工作管理办法》的通知"
CANONICAL_MD = (
    LOCAL_SMOKE_ROOT
    / "object-store"
    / "campus-rag-derived"
    / "campus_notices/documents/internal_notice/关于修订-中央民族大学采购工作管理办法-的通知--187233/source-faithful/2021/canonical.md"
)


class ReadonlyLocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def main() -> None:
    markdown = CANONICAL_MD.read_text(encoding="utf-8")
    preview = extract_internal_notice_parent_regulation_body_preview(
        markdown,
        source_title=SOURCE_TITLE,
    )
    report = _build_report()
    document_report = asdict(report.documents[0])

    (QUICK_DIR / "187233-wrapper-cleanup-preview.json").write_text(
        json.dumps(asdict(preview), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (QUICK_DIR / "187233-promotion-report.json").write_text(
        json.dumps(document_report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (QUICK_DIR / "187233-cleaned-body.md").write_text(
        _render_cleaned_body(markdown=markdown, preview=asdict(preview), document_report=document_report),
        encoding="utf-8",
    )


def _build_report():
    registry = InMemoryDocumentRegistry.from_json_file(LOCAL_SMOKE_ROOT / "registry" / "documents.json")
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_payload = json.loads((LOCAL_SMOKE_ROOT / "registry" / "source-truth-inventory.json").read_text(encoding="utf-8"))
    rows = inventory_payload.values() if isinstance(inventory_payload, dict) else inventory_payload
    inventory_store.upsert_many(
        tuple(
            AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row))
            for row in rows
        )
    )
    object_store = ReadonlyLocalFilesystemObjectStore(LOCAL_SMOKE_ROOT / "object-store")
    return build_internal_notice_regulation_promotion_manifest(
        request=InternalNoticeRegulationPromotionRequest(notice_ids=(NOTICE_ID,)),
        registry=registry,
        source_truth_inventory_store=inventory_store,
        object_store=object_store,
    )


def _render_cleaned_body(*, markdown: str, preview: dict[str, object], document_report: dict[str, object]) -> str:
    lines = [
        "# 187233 Promotion-Side Wrapper Cleanup Preview",
        "",
        f"- Source title: `{preview['source_title']}`",
        f"- Regulation title: `{preview['regulation_title_normalized']}`",
        f"- Wrapper semantics removed: `{str(preview['wrapper_semantics_removed']).lower()}`",
        f"- Standalone body quality passed: `{str(preview['standalone_body_quality_passed']).lower()}`",
        f"- Regulation structure retained: `{str(preview['regulation_structure_retained']).lower()}`",
        f"- Promotable standalone body: `{str(preview['promotable_standalone_body']).lower()}`",
        f"- Promotion action: `{document_report['action']}`",
        f"- Quality gates: `{', '.join(document_report['quality_gates_passed'])}`",
        "",
        "## Removed Leading Lines",
        "",
    ]
    removed_leading = preview["removed_leading_lines"]
    if removed_leading:
        for item in removed_leading:
            lines.append(f"- {item}")
    else:
        lines.append("- None")
    lines.extend(["", "## Removed Trailing Lines", ""])
    removed_trailing = preview["removed_trailing_lines"]
    if removed_trailing:
        for item in removed_trailing:
            lines.append(f"- {item}")
    else:
        lines.append("- None")
    lines.extend(
        [
            "",
            "## Cleaned Body",
            "",
            "```text",
            str(preview["cleaned_body"]),
            "```",
            "",
        ]
    )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
