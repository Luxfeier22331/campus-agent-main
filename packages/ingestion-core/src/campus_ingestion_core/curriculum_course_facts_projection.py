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


_FAMILY_ID = "course_family:muc.ideological_political_theory"
_FAMILY_TITLE = "思想政治理论课"
_SOURCE_TITLE = "中央民族大学通识课程思想政治理论课教学计划"
_SOURCE_DOCUMENT_ID = "curriculum:中央民族大学通识课程思想政治理论课教学计划"
_FAMILY_ALIASES = ("思政课", "思修课", "思政", "思政课程")
_YEAR_RE = re.compile(r"(20[0-9]{2})")
_WHITESPACE_RE = re.compile(r"\s+")
_HTML_BREAK_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_COURSE_ROW_RE = re.compile(
    r"<tr><td>(?P<title>[^<]+)</td><td>(?P<credits>[^<]+)</td><td>(?P<hours>[^<]+)</td>"
    r"<td>(?P<theory_practice>[^<]+)</td><td>(?P<semester>.*?)</td></tr>",
    re.IGNORECASE | re.DOTALL,
)


@dataclass(frozen=True, slots=True)
class _CanonicalCourse:
    canonical_course_id: str
    canonical_course_title: str


@dataclass(frozen=True, slots=True)
class _CourseFactProjection:
    fact_id: str
    fact_type: str
    snippet: str
    detail_label: str
    content_role: str
    section_path: tuple[str, ...]
    canonical_course_id: str | None = None
    canonical_course_title: str | None = None


_CANONICAL_COURSES = (
    _CanonicalCourse("course:muc.marxist_basic_principles", "马克思主义基本原理"),
    _CanonicalCourse("course:muc.modern_chinese_history_outline", "中国近现代史纲要"),
    _CanonicalCourse("course:muc.mao_zedong_thought_and_theoretical_system", "毛泽东思想和中国特色社会主义理论体系概论"),
    _CanonicalCourse("course:muc.xigai", "习近平新时代中国特色社会主义思想概论"),
    _CanonicalCourse("course:muc.ideological_morality_and_rule_of_law", "思想道德与法治"),
    _CanonicalCourse("course:muc.situation_and_policy", "形势与政策"),
    _CanonicalCourse("course:muc.community_for_chinese_nation", "中华民族共同体概论"),
)


def build_curriculum_course_facts_import_documents(
    *,
    raw_asset_record: RawAssetRecord,
    source_pdf: str,
    source_document: SplitManifestDocument | None,
    structured_rows: Sequence[Mapping[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    corpus: str = "curriculum",
    collection: str = "course_facts",
    import_source: str = "provider_response_replay",
) -> list[DocumentImportInput]:
    if source_document is None or source_document.document_id != _SOURCE_DOCUMENT_ID:
        return []

    projections = _build_course_fact_projections(structured_rows)
    if not projections:
        return []

    documents: list[DocumentImportInput] = []
    year = _infer_year(source_pdf)
    for projection in projections:
        document_id = f"course_facts:{projection.fact_id}"
        version_id = _build_projection_version_id(
            raw_version_id=raw_asset_record.raw_version_id,
            fact_id=projection.fact_id,
        )
        document_units_bytes = _serialize_projection_row(
            document_id=document_id,
            version_id=version_id,
            projection=projection,
            source_pdf=source_pdf,
            source_document=source_document,
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
                year=year,
            )
        )
    return documents


def build_curriculum_course_facts_scope_refresh_documents(
    *,
    raw_asset_record: RawAssetRecord,
    source_pdf: str,
    split_manifest_documents: Sequence[SplitManifestDocument],
    structured_rows: Sequence[Mapping[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    import_source: str = "provider_response_replay",
) -> list[DocumentImportInput]:
    source_document = next(
        (document for document in split_manifest_documents if document.document_id == _SOURCE_DOCUMENT_ID),
        None,
    )
    return build_curriculum_course_facts_import_documents(
        raw_asset_record=raw_asset_record,
        source_pdf=source_pdf,
        source_document=source_document,
        structured_rows=structured_rows,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        import_source=import_source,
    )


def _build_course_fact_projections(structured_rows: Sequence[Mapping[str, object]]) -> tuple[_CourseFactProjection, ...]:
    family_members = _extract_family_member_titles(structured_rows)
    audience_snippet = _extract_audience_snippet(structured_rows)
    course_semesters = _extract_course_semesters(structured_rows)
    exceptions = _extract_exception_snippets(structured_rows)

    projections: list[_CourseFactProjection] = [
        _CourseFactProjection(
            fact_id="family-membership",
            fact_type="family_membership",
            snippet=f"{_FAMILY_TITLE}包括{'、'.join(family_members)}。",
            detail_label="课程内容",
            content_role="family_membership",
            section_path=(_FAMILY_TITLE,),
        )
    ]
    if audience_snippet:
        projections.append(
            _CourseFactProjection(
                fact_id="family-audience",
                fact_type="audience",
                snippet=audience_snippet,
                detail_label="修读要求",
                content_role="audience",
                section_path=(_FAMILY_TITLE,),
            )
        )

    for course in _CANONICAL_COURSES:
        semester_lines = course_semesters.get(course.canonical_course_title, ())
        if semester_lines:
            projections.append(
                _CourseFactProjection(
                    fact_id=_fact_id(course.canonical_course_id, "semester"),
                    fact_type="semester",
                    snippet=f"{course.canonical_course_title}开设学期：{'；'.join(semester_lines)}。",
                    detail_label="开设学期",
                    content_role="semester",
                    section_path=(_FAMILY_TITLE, course.canonical_course_title),
                    canonical_course_id=course.canonical_course_id,
                    canonical_course_title=course.canonical_course_title,
                )
            )
        if audience_snippet:
            course_audience = audience_snippet.rstrip("。")
            exception = exceptions.get(course.canonical_course_title)
            if exception:
                course_audience = f"{course_audience}。{exception.rstrip('。')}"
            projections.append(
                _CourseFactProjection(
                    fact_id=_fact_id(course.canonical_course_id, "audience"),
                    fact_type="audience",
                    snippet=f"{course_audience}。",
                    detail_label="修读要求",
                    content_role="audience",
                    section_path=(_FAMILY_TITLE, course.canonical_course_title),
                    canonical_course_id=course.canonical_course_id,
                    canonical_course_title=course.canonical_course_title,
                )
            )
    return tuple(projections)


def _extract_family_member_titles(structured_rows: Sequence[Mapping[str, object]]) -> tuple[str, ...]:
    full_text = " ".join(_normalize_text(row.get("clean_text") or row.get("text_normalized")) for row in structured_rows)
    if "学校除开设" in full_text and "等6门思政课外" in full_text:
        segment = full_text.split("学校除开设", 1)[1].split("等6门思政课外", 1)[0]
        titles = tuple(
            course.canonical_course_title
            for course in _CANONICAL_COURSES
            if course.canonical_course_title in segment
        )
        if titles:
            extra = "中华民族共同体概论"
            return tuple(dict.fromkeys((*titles, extra)))
    return tuple(course.canonical_course_title for course in _CANONICAL_COURSES)


def _extract_audience_snippet(structured_rows: Sequence[Mapping[str, object]]) -> str:
    for row in structured_rows:
        text = _normalize_text(row.get("clean_text") or row.get("text_normalized"))
        if "所有本预科学生" in text and ("公共必修课" in text or "修读要求" in text):
            return text if text.endswith("。") else f"{text}。"
    return ""


def _extract_course_semesters(structured_rows: Sequence[Mapping[str, object]]) -> dict[str, tuple[str, ...]]:
    results: dict[str, tuple[str, ...]] = {}
    for row in structured_rows:
        text = str(row.get("clean_text") or row.get("text_normalized") or "")
        if "<table" not in text or "开设学期" not in text or "课程名称" not in text:
            continue
        normalized = _HTML_BREAK_RE.sub("\n", text)
        for match in _COURSE_ROW_RE.finditer(normalized):
            title = _strip_html(match.group("title"))
            semester_text = _normalize_text(_strip_html(match.group("semester")).replace("\n", " "))
            if title and semester_text:
                results[title] = _split_semester_lines(semester_text)
    return results


def _extract_exception_snippets(structured_rows: Sequence[Mapping[str, object]]) -> dict[str, str]:
    results: dict[str, str] = {}
    for row in structured_rows:
        text = _normalize_text(row.get("clean_text") or row.get("text_normalized"))
        if "不开设" not in text:
            continue
        for course in _CANONICAL_COURSES:
            if course.canonical_course_title in text:
                results[course.canonical_course_title] = text if text.endswith("。") else f"{text}。"
    return results


def _serialize_projection_row(
    *,
    document_id: str,
    version_id: str,
    projection: _CourseFactProjection,
    source_pdf: str,
    source_document: SplitManifestDocument,
) -> bytes:
    payload = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"{document_id}:row-0001",
        "clean_text": projection.snippet,
        "source_pdf": source_pdf,
        "source_url": f"campusrag://rag-data/canonical/curriculum_plan/docs/{_SOURCE_TITLE}.md",
        "source": {"id": f"campusrag://rag-data/canonical/curriculum_plan/docs/{_SOURCE_TITLE}.md"},
        "page_start": 22,
        "page_end": 26,
        "entitlement_groups": list(source_document.resolved_entitlement_groups()),
        "visibility_scope": source_document.resolved_visibility_scope(),
        "visibility_level": source_document.resolved_visibility_level(),
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "anchor": {
            "fact_type": projection.fact_type,
            "section_path": list(projection.section_path),
            "detail_label": projection.detail_label,
        },
        "unit_type": "course_fact",
        "root_unit_id": f"{document_id}:root",
        "metadata": {
            "source_title": _SOURCE_TITLE,
            "content_kind": "course_fact",
            "content_role": projection.content_role,
            "detail_label": projection.detail_label,
            "is_answer_bearing": True,
            "canonical_course_family_id": _FAMILY_ID,
            "canonical_course_family_title": _FAMILY_TITLE,
            "family_aliases": list(_FAMILY_ALIASES),
            **(
                {
                    "canonical_course_id": projection.canonical_course_id,
                    "canonical_course_title": projection.canonical_course_title,
                }
                if projection.canonical_course_id and projection.canonical_course_title
                else {}
            ),
        },
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _projection_title(projection: _CourseFactProjection) -> str:
    if projection.canonical_course_title:
        return f"{projection.canonical_course_title}课程事实"
    return f"{_FAMILY_TITLE}课程事实"


def _build_projection_version_id(*, raw_version_id: str, fact_id: str) -> str:
    digest = hashlib.sha256(f"{raw_version_id}|{fact_id}".encode("utf-8")).hexdigest()[:12]
    return f"{raw_version_id}:course-facts:{fact_id}:{digest}"


def _fact_id(canonical_course_id: str, fact_type: str) -> str:
    return f"{canonical_course_id.split(':', 1)[-1]}-{fact_type}"


def _split_semester_lines(value: str) -> tuple[str, ...]:
    lines = []
    for part in re.split(r"(?=第[0-9一二三四五六七八九十]+学期)|；|;", value):
        normalized = _normalize_text(part)
        if normalized:
            lines.append(normalized)
    return tuple(dict.fromkeys(lines))


def _strip_html(value: str) -> str:
    return _normalize_text(_HTML_TAG_RE.sub(" ", value))


def _infer_year(source_pdf: str) -> str | None:
    match = _YEAR_RE.search(source_pdf)
    return match.group(1) if match else None


def _normalize_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return _WHITESPACE_RE.sub(" ", value.strip())
