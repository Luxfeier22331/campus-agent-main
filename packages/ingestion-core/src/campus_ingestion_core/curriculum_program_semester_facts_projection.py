from __future__ import annotations

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from dataclasses import dataclass
import hashlib
import json
import re
from typing import Mapping, Sequence

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument


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
    provider_response_key: str,
    layout_elements_key: str,
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
                    source_label=f"{provider_response_key}#{document_id}",
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
                    additional_processed_object_keys=(layout_elements_key,),
                    title=_projection_title(projection),
                    year=None,
                )
            )
    return documents


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
        text = _row_text(row)
        if "课程名称" not in text:
            continue
        table_rows = _extract_table_rows(text)
        if not table_rows:
            continue
        row_page_start = _row_page_start(row, fallback=source_document.page_start)
        row_page_end = _row_page_end(row, fallback=source_document.page_end)
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
            page_start=page_bounds_by_semester.get(semester_label, (source_document.page_start, source_document.page_end))[0],
            page_end=page_bounds_by_semester.get(semester_label, (source_document.page_start, source_document.page_end))[1],
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


def _extract_table_rows(text: str) -> tuple[tuple[str, ...], ...]:
    if "<table" in text.lower():
        rows = tuple(
            tuple(
                _normalize_text(_strip_html(cell))
                for cell in _HTML_CELL_RE.findall(row_match.group(1))
                if _normalize_text(_strip_html(cell))
            )
            for row_match in _HTML_ROW_RE.finditer(text)
        )
        return tuple(row for row in rows if row)
    rows = tuple(
        tuple(_normalize_text(cell) for cell in line.split("|"))
        for line in re.split(r"[\r\n]+", text)
        if "|" in line
    )
    return tuple(row for row in rows if row)


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
    page_start = _row_page_start(row, fallback=0)
    page_end = _row_page_end(row, fallback=page_start)
    return (
        page_start >= source_document.page_start
        and page_end <= source_document.page_end
    )


def _row_text(row: Mapping[str, object]) -> str:
    return str(row.get("clean_text") or row.get("text_normalized") or "").strip()


def _row_page_start(row: Mapping[str, object], *, fallback: int) -> int:
    value = row.get("page_start")
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return fallback


def _row_page_end(row: Mapping[str, object], *, fallback: int) -> int:
    value = row.get("page_end")
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return fallback


def _build_version_id(
    *,
    raw_version_id: str,
    source_document_id: str,
    semester_label: str,
) -> str:
    digest = hashlib.sha256(f"{raw_version_id}|{source_document_id}|{semester_label}".encode("utf-8")).hexdigest()[:12]
    return f"{raw_version_id}:program-semester:{digest}"


def _projection_title(projection: _ProgramSemesterProjection) -> str:
    return f"{projection.source_document.title} {projection.semester_label}课程事实"


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
