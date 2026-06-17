from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.artifacts import DOCUMENT_UNITS_FILENAME
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
    load_metadata_from_bytes,
)
from campus_ingestion_core.collection_config import resolve_collection_truth_config
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_raw_asset_key,
    infer_year_label,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.source_truth_common import build_position_preserving_table_rows
from campus_ingestion_core.split_manifest import SplitManifestDocument, load_split_manifest

_SEMESTER_LABEL_TO_INDEX = {
    "第一学期": "1",
    "第二学期": "2",
    "第三学期": "3",
    "第四学期": "4",
    "第五学期": "5",
    "第六学期": "6",
    "第七学期": "7",
    "第八学期": "8",
    "第九学期": "9",
    "第十学期": "10",
}
_SEMESTER_INDEX_TO_LABEL = {index: label for label, index in _SEMESTER_LABEL_TO_INDEX.items()}
_HTML_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_HTML_CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.IGNORECASE | re.DOTALL)
_HTML_BREAK_RE = re.compile(r"<br\\s*/?>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\\s+")
_EMPTY_TABLE_CELLS = frozenset({"", "-", "—", "/", "／", "0"})
_DEFAULT_CANONICAL_PARSER_VERSION = "paddleocr-vl-1.5"


class ProgramSemesterFactsMaterializationObjectStore(Protocol):
    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...

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
class _CurriculumSemesterTableLayout:
    single_semester_index: int = -1
    distribution_semester_indexes: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True, slots=True)
class _ProgramSemesterProjection:
    source_document: SplitManifestDocument
    semester_label: str
    course_titles: tuple[str, ...]
    page_start: int
    page_end: int


@dataclass(frozen=True, slots=True)
class CurriculumProgramSemesterFactsMaterializationReport:
    source_document_count: int
    materialized_document_count: int
    created_document_ids: tuple[str, ...]
    updated_document_ids: tuple[str, ...]
    raw_asset_id: str
    raw_version_id: str
    source_pdf: str


def build_curriculum_program_semester_fact_document_id(
    source_document_id: str,
    semester_label: str,
) -> str:
    suffix = source_document_id.split(":", 1)[-1].strip()
    semester_index = _SEMESTER_LABEL_TO_INDEX.get(semester_label, "").strip()
    if not suffix or not semester_index:
        raise ValueError("source_document_id and semester_label must be resolvable")
    return f"program_semester_facts:{suffix}:semester-{semester_index}"


def build_curriculum_program_semester_facts_scope_refresh_documents(
    *,
    raw_asset_record: RawAssetRecord,
    source_pdf: str,
    split_manifest_documents: Sequence[SplitManifestDocument],
    structured_rows: Sequence[Mapping[str, object]],
    provider_response_key: str | None,
    layout_elements_key: str | None,
    corpus: str = "curriculum",
    collection: str = "program_semester_facts",
    import_source: str = "provider_response_replay",
) -> list[DocumentImportInput]:
    documents: list[DocumentImportInput] = []
    for source_document in split_manifest_documents:
        if source_document.status != "active":
            continue
        projections = _build_program_semester_projections(
            source_document=source_document,
            structured_rows=structured_rows,
        )
        for projection in projections:
            document_id = build_curriculum_program_semester_fact_document_id(
                source_document.document_id,
                projection.semester_label,
            )
            version_id = _build_version_id(
                raw_version_id=raw_asset_record.raw_version_id,
                source_document_id=source_document.document_id,
                semester_label=projection.semester_label,
            )
            document_units_bytes = _serialize_projection_row(
                document_id=document_id,
                version_id=version_id,
                source_pdf=source_pdf,
                projection=projection,
            )
            metadata = load_metadata_from_bytes(document_units_bytes)
            metadata["title"] = _projection_title(projection)
            apply_authorization_projection_metadata(
                metadata,
                entitlement_groups=source_document.resolved_entitlement_groups(),
                visibility_scope=source_document.resolved_visibility_scope(),
                visibility_level=source_document.resolved_visibility_level(),
            )
            metadata["status"] = source_document.status
            documents.append(
                DocumentImportInput(
                    source_label=_projection_source_label(
                        provider_response_key=provider_response_key,
                        raw_asset_record=raw_asset_record,
                        document_id=document_id,
                    ),
                    document_units_bytes=document_units_bytes,
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata=metadata,
                    import_source=import_source,
                    revision_track="source-faithful",
                    source_channel="pdf_ocr",
                    is_current=False,
                    corpus=corpus,
                    collection=collection,
                    visibility_scope=source_document.resolved_visibility_scope(),
                    status=source_document.status,
                    raw_path=None,
                    raw_source_uri=raw_asset_record.raw_source_uri,
                    raw_asset_id=raw_asset_record.raw_asset_id,
                    raw_version_id=raw_asset_record.raw_version_id,
                    provider_response_object_key=provider_response_key,
                    additional_processed_object_keys=tuple(
                        key for key in (layout_elements_key,) if key is not None
                    ),
                    title=_projection_title(projection),
                    year=None,
                )
            )
    return documents


def materialize_curriculum_program_semester_facts_from_canonical_scope(
    *,
    env: Mapping[str, str] | None = None,
    object_store: ProgramSemesterFactsMaterializationObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    split_manifest_documents: Sequence[SplitManifestDocument] | None = None,
    raw_asset_record: RawAssetRecord | None = None,
    source_document_units_keys: Mapping[str, str] | None = None,
    source_document_ids: Sequence[str] | None = None,
) -> CurriculumProgramSemesterFactsMaterializationReport:
    source = dict(env if env is not None else os.environ)
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or _build_materialization_object_store(
        object_store_settings
    )
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    runtime_split_manifest_documents, split_manifest_raw_asset_id = (
        _resolve_split_manifest_documents(
            split_manifest_documents=split_manifest_documents,
        )
    )
    runtime_split_manifest_documents = _filter_split_manifest_documents(
        split_manifest_documents=runtime_split_manifest_documents,
        source_document_ids=source_document_ids,
    )
    runtime_source_document_units_keys = (
        dict(source_document_units_keys)
        if source_document_units_keys is not None
        else _resolve_curriculum_plan_document_units_keys(
            object_store=runtime_object_store,
            bucket=object_store_settings.bucket_derived,
        )
    )
    all_rows, canonical_source_pdf, canonical_raw_asset_record = (
        _load_canonical_curriculum_plan_rows(
            object_store=runtime_object_store,
            bucket=object_store_settings.bucket_derived,
            split_manifest_documents=runtime_split_manifest_documents,
            source_document_units_keys=runtime_source_document_units_keys,
            raw_asset_record=raw_asset_record,
            split_manifest_raw_asset_id=split_manifest_raw_asset_id,
        )
    )
    runtime_raw_asset_registry.upsert(canonical_raw_asset_record)
    documents = build_curriculum_program_semester_facts_scope_refresh_documents(
        raw_asset_record=canonical_raw_asset_record,
        source_pdf=canonical_source_pdf,
        split_manifest_documents=runtime_split_manifest_documents,
        structured_rows=all_rows,
        provider_response_key=None,
        layout_elements_key=None,
        import_source="canonical_document_units_materialization",
    )
    stats = collect_import_document_stats(
        documents=documents,
        registry=runtime_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        writer=runtime_object_store,
        object_store=object_store_settings,
        parser_version=_DEFAULT_CANONICAL_PARSER_VERSION,
        embedding_model=_read_embedding_model_name(source),
        cleaning_policy_version=load_runtime_profile(
            "curriculum",
            "program_semester_facts",
        ).cleaning_policy_version,
        default_visibility_scope=None,
        scope_refresh=None if source_document_ids else ("curriculum", "program_semester_facts"),
    )
    return CurriculumProgramSemesterFactsMaterializationReport(
        source_document_count=len(runtime_split_manifest_documents),
        materialized_document_count=len(documents),
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        raw_asset_id=canonical_raw_asset_record.raw_asset_id,
        raw_version_id=canonical_raw_asset_record.raw_version_id,
        source_pdf=canonical_source_pdf,
    )


def _build_program_semester_projections(
    *,
    source_document: SplitManifestDocument,
    structured_rows: Sequence[Mapping[str, object]],
) -> tuple[_ProgramSemesterProjection, ...]:
    course_titles_by_semester: dict[str, list[str]] = {}
    page_bounds_by_semester: dict[str, tuple[int, int]] = {}
    for row in structured_rows:
        if not _row_within_document(row=row, source_document=source_document):
            continue
        table_rows = _extract_table_rows(row)
        if not table_rows:
            continue
        if not any("课程名称" in cell for cells in table_rows for cell in cells):
            continue
        row_page_start = _row_page_start(row, default_value=source_document.page_start)
        row_page_end = _row_page_end(row, default_value=source_document.page_end)
        semester_matches = _extract_semester_course_titles(table_rows)
        for semester_label, course_titles in semester_matches.items():
            if not course_titles:
                continue
            titles = course_titles_by_semester.setdefault(semester_label, [])
            for title in course_titles:
                if title not in titles:
                    titles.append(title)
            if semester_label in page_bounds_by_semester:
                existing_start, existing_end = page_bounds_by_semester[semester_label]
                page_bounds_by_semester[semester_label] = (
                    min(existing_start, row_page_start),
                    max(existing_end, row_page_end),
                )
            else:
                page_bounds_by_semester[semester_label] = (row_page_start, row_page_end)
    return tuple(
        _ProgramSemesterProjection(
            source_document=source_document,
            semester_label=semester_label,
            course_titles=tuple(course_titles),
            page_start=page_bounds_by_semester.get(
                semester_label, (source_document.page_start, source_document.page_end)
            )[0],
            page_end=page_bounds_by_semester.get(
                semester_label, (source_document.page_start, source_document.page_end)
            )[1],
        )
        for semester_label, course_titles in sorted(
            course_titles_by_semester.items(),
            key=lambda item: int(_SEMESTER_LABEL_TO_INDEX.get(item[0], "999")),
        )
        if course_titles
    )


def _extract_semester_course_titles(
    table_rows: tuple[tuple[str, ...], ...],
) -> dict[str, tuple[str, ...]]:
    course_titles_by_semester: dict[str, list[str]] = {}
    table_layout: _CurriculumSemesterTableLayout | None = None
    course_name_index = -1
    for cells in table_rows:
        if not cells:
            continue
        if "课程名称" in cells:
            course_name_index = cells.index("课程名称")
        resolved_layout = _resolve_curriculum_semester_table_layout(cells)
        if resolved_layout is not None:
            table_layout = resolved_layout
            continue
        if course_name_index < 0 or course_name_index >= len(cells):
            continue
        course_title = _normalize_text(cells[course_name_index])
        if not course_title or course_title == "课程名称":
            continue
        semester_labels = _extract_row_semester_labels(cells=cells, layout=table_layout)
        if not semester_labels:
            continue
        for semester_label in semester_labels:
            titles = course_titles_by_semester.setdefault(semester_label, [])
            if course_title not in titles:
                titles.append(course_title)
    return {
        semester_label: tuple(course_titles)
        for semester_label, course_titles in course_titles_by_semester.items()
        if course_titles
    }


def _extract_table_rows(row: Mapping[str, object]) -> tuple[tuple[str, ...], ...]:
    text = _row_text(row)
    html = str(row.get("html") or "").strip() or None
    if html is None and "<table" in text.lower():
        html = text
    return build_position_preserving_table_rows(
        html=html,
        table_cells=row.get("table_cells"),
        pipe_delimited_text=text,
    )


def _resolve_curriculum_semester_table_layout(
    cells: tuple[str, ...],
) -> _CurriculumSemesterTableLayout | None:
    if "课程名称" not in cells:
        return None
    for index, cell in enumerate(cells):
        if cell in {"开设学期", "修读学期"}:
            return _CurriculumSemesterTableLayout(single_semester_index=index)
    distribution_indexes = tuple(
        (_SEMESTER_INDEX_TO_LABEL[cell], index)
        for index, cell in enumerate(cells)
        if cell in _SEMESTER_INDEX_TO_LABEL
    )
    if len(distribution_indexes) >= 2:
        return _CurriculumSemesterTableLayout(distribution_semester_indexes=distribution_indexes)
    return None


def _extract_row_semester_labels(
    *,
    cells: tuple[str, ...],
    layout: _CurriculumSemesterTableLayout | None,
) -> tuple[str, ...]:
    if not cells:
        return ()
    if layout is not None and layout.single_semester_index >= 0:
        if layout.single_semester_index >= len(cells):
            return ()
        return _extract_semester_labels_from_cell(cells[layout.single_semester_index])
    if layout is not None and layout.distribution_semester_indexes:
        return tuple(
            semester_label
            for semester_label, column_index in layout.distribution_semester_indexes
            if column_index < len(cells) and _cell_has_value(cells[column_index])
        )
    return _extract_semester_labels_from_cell(cells[-1])


def _extract_semester_labels_from_cell(value: str) -> tuple[str, ...]:
    normalized = _normalize_text(value)
    if not normalized or normalized in _EMPTY_TABLE_CELLS:
        return ()
    results: list[str] = []
    for start, end in re.findall(r"(?<!\d)(\d+)\s*-\s*(\d+)(?!\d)", normalized):
        for semester_index in range(int(start), int(end) + 1):
            label = _SEMESTER_INDEX_TO_LABEL.get(str(semester_index))
            if label is not None and label not in results:
                results.append(label)
    for number in re.findall(r"\d+", normalized):
        label = _SEMESTER_INDEX_TO_LABEL.get(number)
        if label is not None and label not in results:
            results.append(label)
    for label in _SEMESTER_LABEL_TO_INDEX:
        if label in normalized and label not in results:
            results.append(label)
    return tuple(results)


def _cell_has_value(value: str) -> bool:
    return _normalize_text(value) not in _EMPTY_TABLE_CELLS


def _row_within_document(
    *,
    row: Mapping[str, object],
    source_document: SplitManifestDocument,
) -> bool:
    page_start = _row_page_start(row, default_value=0)
    page_end = _row_page_end(row, default_value=page_start)
    return page_start >= source_document.page_start and page_end <= source_document.page_end


def _row_text(row: Mapping[str, object]) -> str:
    return str(row.get("clean_text") or row.get("text_normalized") or "").strip()


def _row_page_start(row: Mapping[str, object], *, default_value: int) -> int:
    value = row.get("page_start")
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return default_value


def _row_page_end(row: Mapping[str, object], *, default_value: int) -> int:
    value = row.get("page_end")
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return default_value


def _build_version_id(
    *,
    raw_version_id: str,
    source_document_id: str,
    semester_label: str,
) -> str:
    digest = hashlib.sha256(
        f"{raw_version_id}|{source_document_id}|{semester_label}".encode()
    ).hexdigest()[:12]
    return f"{raw_version_id}:program-semester:{digest}"


def _projection_title(projection: _ProgramSemesterProjection) -> str:
    return f"{projection.source_document.title} {projection.semester_label}课程事实"


def _projection_source_label(
    *,
    provider_response_key: str | None,
    raw_asset_record: RawAssetRecord,
    document_id: str,
) -> str:
    if provider_response_key is not None:
        return f"{provider_response_key}#{document_id}"
    return f"{raw_asset_record.raw_source_uri}#{document_id}"


def _projection_snippet(projection: _ProgramSemesterProjection) -> str:
    return (
        f"按当前已采集的《{projection.source_document.title}》，"
        f"{projection.semester_label}有{'、'.join(projection.course_titles)}。"
    )


def _serialize_projection_row(
    *,
    document_id: str,
    version_id: str,
    source_pdf: str,
    projection: _ProgramSemesterProjection,
) -> bytes:
    payload = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"{document_id}:row-0001",
        "clean_text": _projection_snippet(projection),
        "source_pdf": source_pdf,
        "source_url": (
            "campusrag://rag-data/canonical/curriculum_plan/program-semester/"
            f"{projection.source_document.title}/{projection.semester_label}.md"
        ),
        "source": {
            "id": (
                "campusrag://rag-data/canonical/curriculum_plan/program-semester/"
                f"{projection.source_document.title}/{projection.semester_label}.md"
            )
        },
        "page_start": projection.page_start,
        "page_end": projection.page_end,
        "entitlement_groups": list(projection.source_document.resolved_entitlement_groups()),
        "visibility_scope": projection.source_document.resolved_visibility_scope(),
        "visibility_level": projection.source_document.resolved_visibility_level(),
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "anchor": {
            "fact_type": "semester_course_list",
            "section_path": [projection.source_document.title, projection.semester_label],
            "detail_label": f"{projection.semester_label}课程",
        },
        "unit_type": "program_semester_fact",
        "root_unit_id": f"{document_id}:root",
        "metadata": {
            "source_title": _projection_title(projection),
            "content_kind": "program_semester_fact",
            "content_role": "semester_course_list",
            "detail_label": f"{projection.semester_label}课程",
            "is_answer_bearing": True,
            "source_doc_id": projection.source_document.document_id,
            "source_doc_title": projection.source_document.title,
            "semester_label": projection.semester_label,
            "semester_index": _SEMESTER_LABEL_TO_INDEX[projection.semester_label],
            "course_titles": list(projection.course_titles),
        },
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _strip_html(text: str) -> str:
    normalized = _HTML_BREAK_RE.sub("\n", text)
    normalized = _HTML_TAG_RE.sub("", normalized)
    return normalized.strip()


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _build_materialization_object_store(
    settings: ObjectStoreSettings,
) -> ProgramSemesterFactsMaterializationObjectStore:
    from campus_ingestion_core.object_store_admin import S3ObjectStoreAdmin

    return S3ObjectStoreAdmin(settings)


def _filter_split_manifest_documents(
    *,
    split_manifest_documents: Sequence[SplitManifestDocument],
    source_document_ids: Sequence[str] | None,
) -> tuple[SplitManifestDocument, ...]:
    if not source_document_ids:
        return tuple(split_manifest_documents)
    requested_ids = tuple(
        dict.fromkeys(document_id for document_id in source_document_ids if document_id)
    )
    selected_documents = tuple(
        document for document in split_manifest_documents if document.document_id in requested_ids
    )
    if len(selected_documents) != len(requested_ids):
        available_ids = {document.document_id for document in split_manifest_documents}
        missing_ids = tuple(
            document_id for document_id in requested_ids if document_id not in available_ids
        )
        raise ValueError(
            "unknown curriculum source_document_ids for program_semester_facts rematerialization: "
            + ", ".join(missing_ids)
        )
    return selected_documents


def _resolve_split_manifest_documents(
    *,
    split_manifest_documents: Sequence[SplitManifestDocument] | None,
) -> tuple[tuple[SplitManifestDocument, ...], str]:
    collection_config = resolve_collection_truth_config("curriculum", "curriculum_plan")
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus="curriculum",
        expected_collection="curriculum_plan",
    )
    if split_manifest_documents is not None:
        return tuple(split_manifest_documents), split_manifest.raw_asset_id
    return split_manifest.documents, split_manifest.raw_asset_id


def _resolve_curriculum_plan_document_units_keys(
    *,
    object_store: ProgramSemesterFactsMaterializationObjectStore,
    bucket: str,
) -> dict[str, str]:
    keys = object_store.list_keys(
        bucket=bucket,
        prefix="curriculum/documents/curriculum_plan/",
    )
    return {
        _parse_doc_id_from_document_units_rows(object_store.get_bytes(bucket=bucket, key=key)): key
        for key in keys
        if key.endswith(f"/{DOCUMENT_UNITS_FILENAME}")
    }


def _load_canonical_curriculum_plan_rows(
    *,
    object_store: ProgramSemesterFactsMaterializationObjectStore,
    bucket: str,
    split_manifest_documents: Sequence[SplitManifestDocument],
    source_document_units_keys: Mapping[str, str],
    raw_asset_record: RawAssetRecord | None,
    split_manifest_raw_asset_id: str,
) -> tuple[list[dict[str, object]], str, RawAssetRecord]:
    all_rows: list[dict[str, object]] = []
    first_row: dict[str, object] | None = None
    for document in split_manifest_documents:
        if document.status != "active":
            continue
        source_key = source_document_units_keys.get(document.document_id)
        if source_key is None:
            raise ValueError(
                f"missing curriculum_plan document-units key for {document.document_id}"
            )
        rows = _load_document_unit_rows(object_store.get_bytes(bucket=bucket, key=source_key))
        if not rows:
            raise ValueError(f"curriculum_plan document-units is empty: {source_key}")
        if first_row is None:
            first_row = rows[0]
        all_rows.extend(rows)
    if first_row is None:
        raise ValueError("no active curriculum_plan split manifest documents were provided")
    source_pdf = str(first_row.get("source_pdf") or "").strip()
    if not source_pdf:
        raise ValueError("source_pdf is required in canonical curriculum_plan document-units")
    runtime_raw_asset_record = raw_asset_record or _build_raw_asset_record_from_canonical_row(
        first_row=first_row,
        split_manifest_raw_asset_id=split_manifest_raw_asset_id,
        source_pdf=source_pdf,
    )
    return all_rows, source_pdf, runtime_raw_asset_record


def _build_raw_asset_record_from_canonical_row(
    *,
    first_row: Mapping[str, object],
    split_manifest_raw_asset_id: str,
    source_pdf: str,
) -> RawAssetRecord:
    source = first_row.get("source")
    source_url = str(
        first_row.get("source_url")
        or (source.get("id") if isinstance(source, Mapping) else "")
        or ""
    ).strip()
    if not source_url:
        raise ValueError("source_url is required in canonical curriculum_plan document-units")
    raw_version_id = _extract_raw_version_id_from_source_url(source_url)
    return RawAssetRecord(
        raw_asset_id=split_manifest_raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri=f"campusrag://source/curriculum/{split_manifest_raw_asset_id}/{raw_version_id}",
        content_hash=raw_version_id.removeprefix("sha256:"),
        source_filename=source_pdf,
        object_key=build_raw_asset_key(
            corpus="curriculum",
            raw_asset_id=split_manifest_raw_asset_id,
            raw_version_id=raw_version_id,
            filename=source_pdf,
            year=infer_year_label(source_pdf),
        ),
        ingestion_timestamp=datetime.now(UTC).isoformat(),
        import_source="canonical_document_units_materialization",
    )


def _extract_raw_version_id_from_source_url(source_url: str) -> str:
    match = re.search(r"/sha256/([0-9a-f]{64})(?:/|$)", source_url)
    if match is None:
        raise ValueError(f"unable to derive raw_version_id from source_url: {source_url}")
    return f"sha256:{match.group(1)}"


def _parse_doc_id_from_document_units_rows(document_units_bytes: bytes) -> str:
    rows = _load_document_unit_rows(document_units_bytes)
    if not rows:
        raise ValueError("document-units payload is empty")
    document_id = str(rows[0].get("doc_id") or "").strip()
    if not document_id:
        raise ValueError("doc_id is required in canonical document-units")
    return document_id


def _load_document_unit_rows(document_units_bytes: bytes) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in document_units_bytes.decode("utf-8").splitlines()
        if line.strip()
    ]


def _read_embedding_model_name(source: Mapping[str, str]) -> str:
    model = str(
        source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or ""
    ).strip()
    if not model:
        raise ValueError("INGESTION_EMBEDDING_MODEL or EMBEDDING_MODEL is required")
    return model
