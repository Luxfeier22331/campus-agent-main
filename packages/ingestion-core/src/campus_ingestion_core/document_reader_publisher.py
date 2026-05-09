from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Protocol

from campus_ingestion_core.curriculum_course_map_docs_surface import (
    build_curriculum_course_map_docs_surface_object_key,
    load_curriculum_course_map_docs_surface,
)
from campus_ingestion_core.document_reader_assets import (
    build_document_reader_asset_package,
    build_document_reader_publish_entry,
    build_public_docs_sync_manifest,
)
from campus_ingestion_core.models import DocumentRegistryRecord

_SCHEMA_VERSION = "document_reader_publish_manifest_v1"
_DEFAULT_DOCUMENT_READER_SCOPES = frozenset(
    {
        ("curriculum", "curriculum_plan"),
        ("regulations", "institutional_rules"),
        ("regulations", "student_rules"),
    }
)


class DocumentReaderPublisherObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class DocumentReaderPublishReport:
    asset_count: int
    collection_count: int
    document_count: int
    gated_entry_count: int
    manifest: dict[str, object]
    public_entry_count: int


def publish_document_reader_assets(
    *,
    bucket_derived: str,
    generated_at: str,
    object_store: DocumentReaderPublisherObjectStore,
    records: tuple[DocumentRegistryRecord, ...],
    allowed_scopes: frozenset[tuple[str, str]] = _DEFAULT_DOCUMENT_READER_SCOPES,
) -> DocumentReaderPublishReport:
    selected_records = tuple(sorted(records, key=lambda record: _record_sort_key(record)))
    _assert_supported_document_reader_scopes(
        records=selected_records,
        allowed_scopes=allowed_scopes,
    )
    entries: list[dict[str, object]] = []
    collections_by_key: dict[tuple[str, str], dict[str, object]] = {}
    documents: list[dict[str, object]] = []
    document_versions: list[dict[str, object]] = []
    reader_assets: list[dict[str, object]] = []
    search_units: list[dict[str, object]] = []
    asset_count = 0

    for record in selected_records:
        canonical_markdown_bytes, document_units_bytes = _load_required_reader_inputs(
            bucket=bucket_derived,
            object_store=object_store,
            record=record,
        )
        course_maps_bytes, course_map_image_objects = _load_optional_course_map_assets(
            bucket=bucket_derived,
            object_store=object_store,
            record=record,
        )
        package = build_document_reader_asset_package(
            record=record,
            canonical_markdown_bytes=canonical_markdown_bytes,
            document_units_bytes=document_units_bytes,
            course_maps_bytes=course_maps_bytes,
            course_map_image_objects=course_map_image_objects,
        )
        title = _load_reader_title(package.assets["reader.json"])
        entry = build_document_reader_publish_entry(
            record=record,
            title=title,
            published_asset_names=tuple(package.assets.keys()),
        )
        entries.append(entry)

        for asset_name, payload in package.assets.items():
            object_store.put_bytes(
                bucket=bucket_derived,
                key=_source_key_for_asset(entry, asset_name),
                data=payload,
                content_type=_content_type_for_asset(asset_name),
            )
            asset_count += 1

        collection_key = (record.corpus, record.collection)
        collections_by_key[collection_key] = {
            "collection": record.collection,
            "corpus": record.corpus,
            "description": _collection_description(record.corpus, record.collection),
            "displayName": _collection_display_name(record.corpus, record.collection),
            "updatedAt": record.ingestion_timestamp,
        }
        documents.append(_build_document_row(entry))
        document_versions.append(_build_document_version_row(entry, record))
        reader_assets.append(_build_reader_asset_row(entry, record))
        search_units.extend(
            _build_search_units(entry=entry, reader_json=package.assets["reader.json"])
        )

    public_manifest = build_public_docs_sync_manifest(entries=entries, generated_at=generated_at)
    manifest: dict[str, object] = {
        "schemaVersion": _SCHEMA_VERSION,
        "collections": [
            collections_by_key[key]
            for key in sorted(collections_by_key, key=lambda item: (item[0], item[1]))
        ],
        "documentVersions": document_versions,
        "documents": documents,
        "generatedAt": generated_at,
        "publicDocsSyncManifest": public_manifest,
        "readerAssets": reader_assets,
        "searchUnits": search_units,
    }
    return DocumentReaderPublishReport(
        asset_count=asset_count,
        collection_count=len(collections_by_key),
        document_count=len(documents),
        gated_entry_count=sum(1 for entry in entries if entry.get("deliveryMode") == "gated_asset"),
        manifest=manifest,
        public_entry_count=sum(
            1 for entry in entries if entry.get("deliveryMode") == "public_static_asset"
        ),
    )


def _assert_supported_document_reader_scopes(
    *,
    records: tuple[DocumentRegistryRecord, ...],
    allowed_scopes: frozenset[tuple[str, str]],
) -> None:
    unsupported_scopes = tuple(
        sorted(
            {
                (record.corpus, record.collection)
                for record in records
                if (record.corpus, record.collection) not in allowed_scopes
            }
        )
    )
    if unsupported_scopes:
        joined = ", ".join(f"{corpus}/{collection}" for corpus, collection in unsupported_scopes)
        raise ValueError(f"unsupported document reader scope: {joined}")


def _record_sort_key(record: DocumentRegistryRecord) -> tuple[str, str, str, str]:
    return (record.corpus, record.collection, record.document_id, record.version_id)


def _load_required_reader_inputs(
    *,
    bucket: str,
    object_store: DocumentReaderPublisherObjectStore,
    record: DocumentRegistryRecord,
) -> tuple[bytes, bytes]:
    if not record.document_units_object_key:
        raise ValueError(f"missing canonical reader input for {record.document_id}")
    try:
        document_units_bytes = object_store.get_bytes(
            bucket=bucket,
            key=record.document_units_object_key,
        )
    except Exception as exc:
        raise ValueError(f"missing canonical reader input for {record.document_id}") from exc
    if not record.canonical_markdown_object_key:
        raise ValueError(f"missing canonical reader input for {record.document_id}")
    try:
        canonical_markdown_bytes = object_store.get_bytes(
            bucket=bucket,
            key=record.canonical_markdown_object_key,
        )
        return canonical_markdown_bytes, document_units_bytes
    except Exception as exc:
        raise ValueError(f"missing canonical reader input for {record.document_id}") from exc


def _load_optional_course_map_assets(
    *,
    bucket: str,
    object_store: DocumentReaderPublisherObjectStore,
    record: DocumentRegistryRecord,
) -> tuple[bytes | None, dict[str, bytes] | None]:
    if not (record.collection == "curriculum_plan" and record.document_units_object_key):
        return None, None

    surface_key = build_curriculum_course_map_docs_surface_object_key(
        record.document_units_object_key
    )
    try:
        surface_bytes = object_store.get_bytes(bucket=bucket, key=surface_key)
    except Exception:
        return None, None

    try:
        surface = load_curriculum_course_map_docs_surface(surface_bytes)
        image_objects: dict[str, bytes] = {}
        for block in surface.blocks:
            image_objects[block.image_object_key] = object_store.get_bytes(
                bucket=bucket,
                key=block.image_object_key,
            )
        return surface_bytes, image_objects
    except Exception:
        return None, None


def _load_reader_title(reader_json: bytes) -> str:
    payload = json.loads(reader_json.decode("utf-8"))
    return str(payload["document"]["title"])


def _build_document_row(entry: dict[str, object]) -> dict[str, object]:
    return {
        "canonicalUrl": str(entry["canonicalUrl"]),
        "collection": str(entry["collection"]),
        "corpus": str(entry["corpus"]),
        "currentVersionId": str(entry["versionId"]),
        "currentVersionSlug": str(entry["versionSlug"]),
        "docId": str(entry["docId"]),
        "documentSlug": str(entry["documentSlug"]),
        "title": str(entry["title"]),
        "updatedAt": str(entry["updatedAt"]),
    }


def _build_document_version_row(
    entry: dict[str, object],
    record: DocumentRegistryRecord,
) -> dict[str, object]:
    return {
        "deliveryMode": str(entry["deliveryMode"]),
        "docId": record.document_id,
        "effectiveFrom": record.effective_date,
        "entitlementGroups": list(record.entitlement_groups),
        "isCurrent": record.is_current,
        "label": "现行版" if record.is_current else "历史版本",
        "updatedAt": record.ingestion_timestamp,
        "versionId": record.version_id,
        "versionSlug": str(entry["versionSlug"]),
        "visibilityLevel": record.visibility_level
        or ("restricted" if record.entitlement_groups else "public"),
    }


def _build_reader_asset_row(
    entry: dict[str, object],
    record: DocumentRegistryRecord,
) -> dict[str, object]:
    target_objects = entry["targetObjects"]
    if not isinstance(target_objects, dict):
        raise ValueError("reader asset targetObjects must be a dict")
    static_prefix = _static_prefix_from_target(str(target_objects["reader"]))
    return {
        "contentUrl": f"/{target_objects['reader']}",
        "manifestUrl": f"/{target_objects['asset-manifest']}",
        "outlineUrl": f"/{target_objects['outline']}",
        "sourceObjects": entry["sourceObjects"],
        "staticPrefix": static_prefix,
        "targetObjects": target_objects,
        "updatedAt": record.ingestion_timestamp,
        "versionId": record.version_id,
    }


def _build_search_units(
    *,
    entry: dict[str, object],
    reader_json: bytes,
) -> list[dict[str, object]]:
    payload = json.loads(reader_json.decode("utf-8"))
    units: list[dict[str, object]] = []
    version_id = str(entry["versionId"])
    for index, section in enumerate(payload.get("sections") or (), start=1):
        blocks = [
            block for block in section.get("blocks") or () if str(block.get("text") or "").strip()
        ]
        if not blocks:
            continue
        anchor = str(section["anchor"])
        text_parts = [str(block["text"]).strip() for block in blocks]
        root_unit_ids = [
            str(block["rootUnitId"]).strip()
            for block in blocks
            if str(block.get("rootUnitId") or "").strip()
        ]
        units.append(
            {
                "anchor": anchor,
                "canonicalUrl": str(entry["canonicalUrl"]),
                "docId": str(entry["docId"]),
                "highlightRootUnitIds": root_unit_ids[:8],
                "searchText": "\n".join(text_parts),
                "searchUnitId": _search_unit_id(version_id=version_id, anchor=anchor),
                "snippet": _snippet(" ".join(text_parts)),
                "title": str(section["title"]),
                "unitOrder": index,
                "versionId": version_id,
            }
        )
    return units


def _source_key_for_asset(entry: dict[str, object], asset_name: str) -> str:
    source_objects = entry["sourceObjects"]
    if not isinstance(source_objects, dict):
        raise ValueError("reader asset sourceObjects must be a dict")
    if asset_name == "asset-manifest.json":
        return str(source_objects["manifest"])
    if asset_name.endswith(".json") and "/" not in asset_name:
        source_label = asset_name.removesuffix(".json")
        if source_label in source_objects:
            return str(source_objects[source_label])
    supplement_label = f"supplement.{asset_name}"
    return str(source_objects[supplement_label])


def _static_prefix_from_target(target: str) -> str:
    return f"/{PurePosixPath(target).parent}"


def _content_type_for_asset(asset_name: str) -> str:
    if asset_name.endswith(".png"):
        return "image/png"
    return "application/json"


def _search_unit_id(*, version_id: str, anchor: str) -> str:
    digest = hashlib.sha1(f"{version_id}|{anchor}".encode()).hexdigest()[:16]
    return f"docs_search_unit:{digest}"


def _snippet(value: str) -> str:
    normalized = " ".join(value.split())
    return normalized[:240]


def _collection_display_name(corpus: str, collection: str) -> str:
    labels = {
        ("curriculum", "curriculum_plan"): "培养方案",
        ("regulations", "institutional_rules"): "校级规章",
        ("regulations", "scoped_rules"): "专项规章",
        ("regulations", "student_rules"): "学生手册",
    }
    return labels.get((corpus, collection), collection)


def _collection_description(corpus: str, collection: str) -> str:
    labels = {
        ("curriculum", "curriculum_plan"): "当前公开的培养方案与课程计划。",
        ("regulations", "institutional_rules"): "学校层面的正式规章制度。",
        ("regulations", "scoped_rules"): "面向特定单位、事项或周期的专项规则。",
        ("regulations", "student_rules"): "当前公开的学生手册与学生管理规章。",
    }
    return labels.get((corpus, collection), "")


__all__ = [
    "DocumentReaderPublishReport",
    "DocumentReaderPublisherObjectStore",
    "publish_document_reader_assets",
]
