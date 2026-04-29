from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from campus_ingestion_core.authenticated_notice_legacy_export import (
    build_authenticated_notice_legacy_normalized_manifest,
    build_notice_type_policy_snapshot_from_legacy_config,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parent / "accepted-union"
LEGACY_BUNDLE_PATH = Path(
    "/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json"
)
LEGACY_MANIFEST_PATH = Path(
    "/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json"
)
NOTICE_TYPES_PATH = Path("/home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json")
BUNDLE_PATHS = (
    REPO_ROOT
    / ".tmp"
    / "historical-intake"
    / "run14-policy-regulation-expanded"
    / "normalized"
    / "notices-bundle.normalized.json",
    REPO_ROOT
    / ".tmp"
    / "historical-intake"
    / "run14-attachment-routing-probe"
    / "normalized"
    / "notices-bundle.normalized.json",
    REPO_ROOT
    / ".tmp"
    / "historical-intake"
    / "run14-policy-regulation-core"
    / "normalized"
    / "notices-bundle.normalized.json",
)


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _notice_id(record: dict[str, object]) -> str:
    notice = dict(record.get("notice") or {})
    return str(notice.get("notice_id") or record.get("notice_id") or "").strip()


def _selected_notice_type_ids(records: list[dict[str, object]]) -> tuple[str, ...]:
    selected: list[str] = []
    seen: set[str] = set()
    for record in records:
        notice = dict(record.get("notice") or {})
        for category in list(notice.get("categories") or []):
            type_id = str(dict(category).get("notice_type") or "").strip()
            if type_id and type_id not in seen:
                seen.add(type_id)
                selected.append(type_id)
    return tuple(selected)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    merged_by_notice_id: dict[str, dict[str, object]] = {}
    for path in BUNDLE_PATHS:
        payload = _read_json(path)
        if not isinstance(payload, list):
            raise ValueError(f"expected JSON array: {path}")
        for raw_record in payload:
            if not isinstance(raw_record, dict):
                continue
            notice_id = _notice_id(raw_record)
            if not notice_id:
                raise ValueError(f"missing notice_id in {path}")
            merged_by_notice_id.setdefault(notice_id, raw_record)

    merged_records = list(merged_by_notice_id.values())
    selected_notice_ids = tuple(_notice_id(record) for record in merged_records)
    selected_notice_type_ids = _selected_notice_type_ids(merged_records)

    notice_types_payload = _read_json(NOTICE_TYPES_PATH)
    if not isinstance(notice_types_payload, list):
        raise ValueError(f"expected JSON array: {NOTICE_TYPES_PATH}")

    merged_manifest = build_authenticated_notice_legacy_normalized_manifest(
        legacy_manifest=dict(_read_json(LEGACY_MANIFEST_PATH)),
        site_id="muc_internal_portal",
        source_home_url="https://my.muc.edu.cn",
        notice_type_policy=build_notice_type_policy_snapshot_from_legacy_config(notice_types_payload),
        selected_notice_type_ids=selected_notice_type_ids,
        selected_notice_ids=selected_notice_ids,
        filtered_notice_count=len(merged_records),
        original_notice_count=len(list(_read_json(LEGACY_BUNDLE_PATH))),
        export_scope="run14-accepted-union-local-postgres",
        exported_at=datetime.now(timezone.utc).isoformat(),
    )

    bundle_path = OUT_DIR / "notices-bundle.accepted-union.json"
    manifest_path = OUT_DIR / "export-manifest.accepted-union.json"
    selected_ids_path = OUT_DIR / "selected-notice-ids.accepted-union.txt"

    bundle_path.write_text(
        json.dumps(merged_records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(merged_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    selected_ids_path.write_text("\n".join(selected_notice_ids) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "bundle_path": str(bundle_path),
                "manifest_path": str(manifest_path),
                "selected_notice_count": len(selected_notice_ids),
                "selected_notice_ids": list(selected_notice_ids),
                "selected_notice_type_ids": list(selected_notice_type_ids),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
