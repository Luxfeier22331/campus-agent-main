from __future__ import annotations

from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import json
import re
import unicodedata

from campus_ingestion_core.split_manifest import SplitManifestDocument


ARTICLE_PREFIX_RE = re.compile(
    r"^(?P<label>第\s*[0-9一二三四五六七八九十百千万〇零两]+\s*条)\s*(?P<rest>.*)$"
)
SECTION_HEADING_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万〇零两]+[章节编]|总则|附则|实施细则|说明).*$"
)
SECTION_LABEL_RE = re.compile(r"^(?P<label>第[一二三四五六七八九十百千万〇零两]+[章节编])\s*(?P<rest>.*)$")
POLICY_DOC_NO_RE = re.compile(r"^[^\n]{0,40}(?:〔|\[)\d{4}(?:〕|\])\d+号$")
TITLE_VARIANT_SUFFIX_RE = re.compile(r"(?:[(（](?:修订|试行|暂行)[)）]|修订|试行|暂行)$")
LIST_ENTRY_PHONE_RE = re.compile(r"\d{5,}")
LIST_ENTRY_TWO_FIELD_RE = re.compile(r"^[^\s，。；：！？]{1,24}\s+[^\s，。；：！？]{1,24}$")
LIST_SECTION_RANK = 4
PHONE_HEADER_LABELS = {"单位名称", "电话号码"}
PHONE_GROUP_HEADINGS = (
    "校级办公与公共服务",
    "学生事务与安保服务",
    "就业工作处",
    "后勤产业集团",
)
PHONE_GROUP_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("学生事务与安保服务", ("学生处", "学生管理科", "思想政治教育科", "助学服务中心", "心理健康教育与咨询中心", "保卫武装部", "治安科", "户籍科", "安全消防科", "东校门", "西校门")),
    ("就业工作处", ("就业指导", "就业信息管理", "就业市场管理")),
    ("后勤产业集团", ("公寓管理部", "餐饮服务部", "电工班", "锅炉班", "维修班", "水工班", "电梯班")),
)


@dataclass(frozen=True, slots=True)
class HandbookCleanupResult:
    title: str
    doc_id: str
    version_id: str
    metadata: dict[str, object]
    canonical_markdown: str
    document_units: tuple[dict[str, object], ...]


def cleanup_handbook_document(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
    source_doc: str,
) -> HandbookCleanupResult:
    projected_rows = _project_manifest_rows(structured_rows, manifest_document)
    if not projected_rows:
        raise ValueError(f"manifest document {manifest_document.document_id} does not match any source rows")
    if not manifest_document.handbook_section:
        raise ValueError("handbook manifest document requires handbook_section")

    title = _select_title(projected_rows, manifest_document.title, manifest_document.page_start)
    content_rows = _filter_content_rows(projected_rows, title=title, title_page=manifest_document.page_start)
    events, policy_doc_no = _build_document_events(content_rows)

    metadata: dict[str, object] = {
        "title": title,
        "source_doc": source_doc,
        "page_start": manifest_document.page_start,
        "page_end": manifest_document.page_end,
        "handbook_section": manifest_document.handbook_section,
    }
    if policy_doc_no is not None:
        metadata["policy_doc_no"] = policy_doc_no

    canonical_body = _build_canonical_body(events, policy_doc_no=policy_doc_no)
    doc_id = build_handbook_doc_id(title)
    version_id = build_handbook_version_id(title, canonical_body)
    canonical_markdown = _build_canonical_markdown(
        title=title,
        doc_id=doc_id,
        metadata=metadata,
        canonical_body=canonical_body,
    )
    document_rows = _build_document_rows(
        events=events,
        doc_id=doc_id,
        version_id=version_id,
        source_pdf=source_doc,
        source_url=manifest_document.source_uri,
        acl_groups=manifest_document.acl_groups,
    )
    return HandbookCleanupResult(
        title=title,
        doc_id=doc_id,
        version_id=version_id,
        metadata=metadata,
        canonical_markdown=canonical_markdown,
        document_units=tuple(document_rows),
    )


def serialize_handbook_document_units(rows: tuple[dict[str, object], ...] | list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def build_handbook_doc_id(title: str) -> str:
    return "handbook:" + hashlib.sha1(normalize_handbook_title(title).encode("utf-8")).hexdigest()


def build_handbook_version_id(title: str, canonical_body: str) -> str:
    digest_input = f"{normalize_handbook_title(title)}\n\n{normalize_handbook_body_text(canonical_body)}"
    return "v1:" + hashlib.sha1(digest_input.encode("utf-8")).hexdigest()


def validate_handbook_manifest_title(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
) -> None:
    candidate_title = extract_handbook_title_candidate(
        structured_rows=structured_rows,
        first_page=manifest_document.page_start,
    )
    if candidate_title is None or _is_placeholder_title(manifest_document.title):
        return
    if _normalize_title_for_match(candidate_title) == _normalize_title_for_match(manifest_document.title):
        return
    raise ValueError(
        "manifest title mismatch for "
        f"{manifest_document.document_id}: OCR title {normalize_handbook_title(candidate_title)!r} "
        f"!= manifest title {normalize_handbook_title(manifest_document.title)!r}"
    )


def normalize_handbook_title(value: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value).strip().split())
    return re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", normalized)


def normalize_handbook_body_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    return "\n".join(line for line in lines if line)


def _project_manifest_rows(
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
) -> list[dict[str, object]]:
    selected = [
        row
        for row in structured_rows
        if _coerce_int(row.get("page_start")) is not None
        and _coerce_int(row.get("page_end")) is not None
        and int(row["page_start"]) >= manifest_document.page_start
        and int(row["page_end"]) <= manifest_document.page_end
    ]
    return sorted(selected, key=_row_sort_key)


def _row_sort_key(row: dict[str, object]) -> tuple[int, int, str]:
    return (
        _coerce_int(row.get("page_start")) or 0,
        _coerce_int(row.get("row_index")) or 0,
        str(row.get("row_id") or ""),
    )


def _select_title(
    projected_rows: list[dict[str, object]],
    manifest_title: str,
    first_page: int,
) -> str:
    candidate_title = extract_handbook_title_candidate(structured_rows=projected_rows, first_page=first_page)
    if candidate_title is not None:
        if _is_placeholder_title(manifest_title):
            return candidate_title
        if _normalize_title_for_match(candidate_title) == _normalize_title_for_match(manifest_title):
            return normalize_handbook_title(manifest_title)
        return normalize_handbook_title(manifest_title)
    return normalize_handbook_title(manifest_title)


def extract_handbook_title_candidate(
    *,
    structured_rows: list[dict[str, object]],
    first_page: int,
) -> str | None:
    candidates: list[tuple[float, int, str]] = []
    for row in structured_rows:
        if _coerce_int(row.get("page_start")) != first_page:
            continue
        if str(row.get("row_type") or "") != "heading":
            continue
        if bool(row.get("is_repeated_candidate")):
            continue
        text = _row_text(row)
        if not text:
            continue
        candidates.append(
            (
                float(row.get("title_candidate_score") or 0.0),
                -(int(row.get("reading_order") or 0)),
                text,
            )
        )
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][2]


def _is_placeholder_title(value: str) -> bool:
    return normalize_handbook_title(value) in {"制度标题", "占位标题"}


def _normalize_title_for_match(value: str) -> str:
    normalized = normalize_handbook_title(value)
    normalized = TITLE_VARIANT_SUFFIX_RE.sub("", normalized).strip()
    return normalized


def _filter_content_rows(
    projected_rows: list[dict[str, object]],
    *,
    title: str,
    title_page: int,
) -> list[dict[str, object]]:
    filtered: list[dict[str, object]] = []
    title_consumed = False
    normalized_title = normalize_handbook_title(title)
    for row in projected_rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") in {"header", "footer", "page_number"}:
            continue
        text = _row_text(row)
        if not text and str(row.get("row_type") or "") != "table":
            continue
        if (
            not title_consumed
            and _coerce_int(row.get("page_start")) == title_page
            and str(row.get("row_type") or "") == "heading"
            and normalize_handbook_title(text) == normalized_title
        ):
            title_consumed = True
            continue
        filtered.append(row)
    return filtered


def _build_document_events(content_rows: list[dict[str, object]]) -> tuple[list[dict[str, object]], str | None]:
    policy_doc_no: str | None = None
    current_section_nodes: list[tuple[int, str]] = []
    preface_parts: list[str] = []
    events: list[dict[str, object]] = []
    current_article: dict[str, object] | None = None
    current_policy_page: dict[str, object] | None = None
    active_article_context: dict[str, object] | None = None
    pending_table_context: str | None = None

    def flush_article() -> None:
        nonlocal current_article
        if current_article is None:
            return
        current_article["text"] = normalize_handbook_body_text("\n".join(current_article.pop("parts")))
        events.append(current_article)
        current_article = None

    def flush_policy_page() -> None:
        nonlocal current_policy_page
        if current_policy_page is None:
            return
        text = normalize_handbook_body_text("\n".join(current_policy_page.pop("parts")))
        if text:
            current_policy_page["text"] = text
            events.append(current_policy_page)
        current_policy_page = None

    for row_index, row in enumerate(content_rows):
        row_type = str(row.get("row_type") or "")
        text = _row_text(row)
        page_start = _coerce_int(row.get("page_start")) or 0
        page_end = _coerce_int(row.get("page_end")) or page_start
        next_text = _next_content_text(content_rows, row_index + 1)

        if row_type == "table":
            roster_policy_pages = _project_phone_table_policy_pages(
                row=row,
                page_start=page_start,
                page_end=page_end,
            )
            if roster_policy_pages:
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                events.extend(roster_policy_pages)
            flush_policy_page()
            table_context = pending_table_context if active_article_context is not None else None
            events.append(
                {
                    "kind": "table",
                    "page_start": page_start,
                    "page_end": page_end,
                    "text": normalize_handbook_body_text(text),
                    "table_cells": row.get("table_cells"),
                    "html": row.get("html"),
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                    "article_label": active_article_context["label"] if active_article_context is not None else None,
                    "table_context": table_context,
                }
            )
            pending_table_context = None
            continue

        if not text:
            continue

        if policy_doc_no is None and _looks_like_policy_doc_no(text):
            policy_doc_no = _normalize_policy_doc_no(text)
            preface_parts.append(policy_doc_no)
            continue

        if row_type == "heading" and _is_section_heading(text):
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            normalized_heading = _normalize_section_heading(text)
            heading_rank = _section_heading_rank(normalized_heading)
            current_section_nodes = [node for node in current_section_nodes if node[0] < heading_rank]
            current_section_nodes.append((heading_rank, normalized_heading))
            events.append(
                {
                    "kind": "section",
                    "text": normalized_heading,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            )
            continue

        article_label, rest = _split_article_line(text)
        if article_label is not None:
            flush_policy_page()
            flush_article()
            current_article = {
                "kind": "article",
                "label": article_label,
                "parts": [rest] if rest else [],
                "page_start": page_start,
                "page_end": page_end,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
            active_article_context = {
                "label": article_label,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
            pending_table_context = None
            continue

        if current_article is not None:
            current_article["parts"].append(text)
            current_article["page_end"] = page_end
            if _looks_like_table_context(text):
                pending_table_context = text
            else:
                pending_table_context = None
            continue

        if _looks_like_list_section_heading(text, next_text):
            flush_policy_page()
            active_article_context = None
            normalized_heading = normalize_handbook_body_text(text)
            current_section_nodes = [node for node in current_section_nodes if node[0] < LIST_SECTION_RANK]
            current_section_nodes.append((LIST_SECTION_RANK, normalized_heading))
            events.append(
                {
                    "kind": "section",
                    "text": normalized_heading,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            )
            continue

        if current_policy_page is not None or _looks_like_list_entry(text):
            if current_policy_page is None:
                current_policy_page = {
                    "kind": "policy_page",
                    "parts": [],
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            current_policy_page["parts"].append(text)
            current_policy_page["page_end"] = page_end
            continue

        flush_policy_page()
        active_article_context = None
        pending_table_context = None
        preface_parts.append(text)

    flush_article()
    flush_policy_page()
    if preface_parts:
        events.insert(
            0,
            {
                "kind": "policy_page",
                "text": normalize_handbook_body_text("\n".join(preface_parts)),
                "page_start": _coerce_int(content_rows[0].get("page_start")) or 0,
                "page_end": _coerce_int(content_rows[-1].get("page_end")) or 0,
                "section_path": (),
            },
        )

    substantive_events = [event for event in events if event["kind"] != "section"]
    if not substantive_events:
        raise ValueError("handbook document cleanup produced no content units")
    return events, policy_doc_no


def _build_canonical_body(
    events: list[dict[str, object]],
    *,
    policy_doc_no: str | None,
) -> str:
    parts: list[str] = []
    for event in events:
        kind = str(event["kind"])
        if kind == "section":
            parts.append(f"## {event['text']}")
            continue
        if kind == "article":
            article_text = str(event.get("text") or "")
            if article_text:
                parts.append(f"### {event['label']}\n{article_text}")
            else:
                parts.append(f"### {event['label']}")
            continue
        if kind == "policy_page":
            parts.append(str(event["text"]))
            continue
        if kind == "table":
            table_text = str(event.get("text") or "")
            parts.append(f"[表格]\n{table_text}" if table_text else "[表格]")
            continue
    return "\n\n".join(part for part in parts if part)


def _build_canonical_markdown(
    *,
    title: str,
    doc_id: str,
    metadata: dict[str, object],
    canonical_body: str,
) -> str:
    front_matter_lines = [
        "---",
        "schema_version: 1",
        f"doc_id: {doc_id}",
        "corpus: regulations",
        "collection: student_handbook",
        f"title: '{_escape_yaml_string(title)}'",
        "source_kind: ocr",
        f"source_doc: '{_escape_yaml_string(str(metadata['source_doc']))}'",
        f"handbook_section: '{_escape_yaml_string(str(metadata['handbook_section']))}'",
        f"page_start: {metadata['page_start']}",
        f"page_end: {metadata['page_end']}",
    ]
    policy_doc_no = metadata.get("policy_doc_no")
    if isinstance(policy_doc_no, str) and policy_doc_no:
        front_matter_lines.append(f"policy_doc_no: '{_escape_yaml_string(policy_doc_no)}'")
    front_matter_lines.append("---")
    front_matter_lines.append("")
    front_matter_lines.append(f"# {title}")
    if canonical_body:
        front_matter_lines.append("")
        front_matter_lines.append(canonical_body)
    return "\n".join(front_matter_lines).strip() + "\n"


def _build_document_rows(
    *,
    events: list[dict[str, object]],
    doc_id: str,
    version_id: str,
    source_pdf: str,
    source_url: str,
    acl_groups: tuple[str, ...],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    policy_index = 0
    article_index = 0
    table_index = 0

    for event in events:
        kind = str(event["kind"])
        if kind == "section":
            continue
        if kind == "policy_page":
            policy_index += 1
            root_unit_id = f"policy-page-{policy_index:04d}"
            rows.append(
                _build_structured_unit_row(
                    doc_id=doc_id,
                    version_id=version_id,
                    chunk_id=root_unit_id,
                    root_unit_id=root_unit_id,
                    unit_type="policy_page",
                    clean_text=str(event["text"]),
                    source_pdf=source_pdf,
                    source_url=source_url,
                    acl_groups=acl_groups,
                    anchor={
                        "page_start": int(event["page_start"]),
                        "page_end": int(event["page_end"]),
                        "section_path": list(event.get("section_path") or ()),
                    },
                )
            )
            continue
        if kind == "article":
            article_index += 1
            root_unit_id = f"article-{article_index:04d}"
            rows.append(
                _build_structured_unit_row(
                    doc_id=doc_id,
                    version_id=version_id,
                    chunk_id=root_unit_id,
                    root_unit_id=root_unit_id,
                    unit_type="article_body",
                    clean_text=str(event.get("text") or ""),
                    source_pdf=source_pdf,
                    source_url=source_url,
                    acl_groups=acl_groups,
                    anchor={
                        "page_start": int(event["page_start"]),
                        "page_end": int(event["page_end"]),
                        "section_path": list(event.get("section_path") or ()),
                        "article_label": str(event["label"]),
                    },
                )
            )
            continue
        if kind == "table":
            table_index += 1
            root_unit_id = f"table-{table_index:04d}"
            table_cells = _normalize_table_matrix(
                html=event.get("html"),
                table_cells=event.get("table_cells"),
            )
            rows.append(
                _build_structured_unit_row(
                    doc_id=doc_id,
                    version_id=version_id,
                    chunk_id=root_unit_id,
                    root_unit_id=root_unit_id,
                    unit_type="table",
                    clean_text=str(event.get("text") or ""),
                    source_pdf=source_pdf,
                    source_url=source_url,
                    acl_groups=acl_groups,
                    anchor={
                        "page_start": int(event["page_start"]),
                        "page_end": int(event["page_end"]),
                        "section_path": list(event.get("section_path") or ()),
                        "article_label": event.get("article_label"),
                        "table_context": event.get("table_context"),
                    },
                    html=event.get("html"),
                    table_cells=table_cells,
                )
            )
            if isinstance(table_cells, list):
                header_row = _table_header_row(table_cells)
                for row_index, cell_row in enumerate(table_cells, start=1):
                    rows.append(
                        _build_structured_unit_row(
                            doc_id=doc_id,
                            version_id=version_id,
                            chunk_id=f"{root_unit_id}-row-{row_index:04d}",
                            root_unit_id=root_unit_id,
                            unit_type="table_row",
                            clean_text=_build_table_row_clean_text(cell_row=cell_row, header_row=header_row, row_index=row_index),
                            source_pdf=source_pdf,
                            source_url=source_url,
                            acl_groups=acl_groups,
                            anchor={
                                "page_start": int(event["page_start"]),
                                "page_end": int(event["page_end"]),
                                "section_path": list(event.get("section_path") or ()),
                                "article_label": event.get("article_label"),
                                "table_context": event.get("table_context"),
                                "table_row_index": row_index,
                            },
                            table_cells=[list(str(cell) for cell in cell_row)],
                        )
                    )
    return rows


def _build_structured_unit_row(
    *,
    doc_id: str,
    version_id: str,
    chunk_id: str,
    root_unit_id: str,
    unit_type: str,
    clean_text: str,
    source_pdf: str,
    source_url: str,
    acl_groups: tuple[str, ...],
    anchor: dict[str, object],
    html: object = None,
    table_cells: object = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id,
        "root_unit_id": root_unit_id,
        "unit_type": unit_type,
        "clean_text": clean_text,
        "source_pdf": source_pdf,
        "source_url": source_url,
        "source_md": None,
        "source": {"id": source_url},
        "page_start": int(anchor["page_start"]),
        "page_end": int(anchor["page_end"]),
        "anchor": anchor,
        "acl": _build_acl_metadata(acl_groups),
        "html": html,
        "table_cells": table_cells,
    }


def _build_acl_metadata(acl_groups: tuple[str, ...]) -> dict[str, object]:
    return {
        "level": "restricted" if acl_groups else "public",
        "allow_groups": list(acl_groups),
    }


def _row_text(row: dict[str, object]) -> str:
    for field_name in ("text_normalized", "text_raw"):
        value = row.get(field_name)
        if isinstance(value, str) and value.strip():
            return normalize_handbook_body_text(value)
    return ""


def _normalize_table_matrix(*, html: object, table_cells: object) -> list[list[str]] | None:
    html_matrix = _parse_html_table_matrix(html) if isinstance(html, str) and html.strip() else None
    cell_matrix = _normalize_table_cells_matrix(table_cells)
    if html_matrix and cell_matrix:
        return html_matrix if _matrix_information_score(html_matrix) >= _matrix_information_score(cell_matrix) else cell_matrix
    return html_matrix or cell_matrix


def _normalize_table_cells_matrix(table_cells: object) -> list[list[str]] | None:
    if not isinstance(table_cells, list):
        return None
    normalized_rows: list[list[str]] = []
    max_width = 0
    for row in table_cells:
        if not isinstance(row, list):
            continue
        normalized_row = [str(cell) for cell in row]
        normalized_rows.append(normalized_row)
        max_width = max(max_width, len(normalized_row))
    if max_width == 0:
        return None
    return [row + [""] * (max_width - len(row)) for row in normalized_rows]


def _table_header_row(table_matrix: list[list[str]]) -> list[str] | None:
    if not table_matrix:
        return None
    header = table_matrix[0]
    if not any(cell.strip() for cell in header):
        return None
    return header


def _build_table_row_clean_text(*, cell_row: list[str], header_row: list[str] | None, row_index: int) -> str:
    if header_row is None or row_index == 1:
        return " | ".join(cell_row)
    counts: dict[str, int] = {}
    parts: list[str] = []
    for header, value in zip(header_row, cell_row, strict=False):
        label = header.strip() if isinstance(header, str) else ""
        if not label:
            label = "列"
        counts[label] = counts.get(label, 0) + 1
        suffix = f"_{counts[label]}" if counts[label] > 1 else ""
        parts.append(f"{label}{suffix}={value}")
    return " | ".join(parts)


class _HtmlTableMatrixParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._pending_rowspans: dict[tuple[int, int], str] = {}
        self._current_row_index = -1
        self._current_col_index = 0
        self._current_row: list[str] | None = None
        self._current_cell_parts: list[str] | None = None
        self._current_cell_attrs: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if normalized_tag == "tr":
            self._start_row()
            return
        if normalized_tag in {"td", "th"} and self._current_row is not None:
            self._advance_to_next_open_column()
            self._current_cell_parts = []
            self._current_cell_attrs = {name.lower(): value or "" for name, value in attrs}

    def handle_data(self, data: str) -> None:
        if self._current_cell_parts is not None:
            self._current_cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in {"td", "th"} and self._current_row is not None and self._current_cell_parts is not None:
            self._close_cell()
            return
        if normalized_tag == "tr" and self._current_row is not None:
            self.rows.append(self._current_row)
            self._current_row = None
            self._current_cell_parts = None
            self._current_cell_attrs = {}

    def _start_row(self) -> None:
        self._current_row_index += 1
        self._current_col_index = 0
        self._current_row = []
        self._current_cell_parts = None
        self._current_cell_attrs = {}
        self._apply_rowspans_for_current_row()

    def _apply_rowspans_for_current_row(self) -> None:
        while True:
            key = (self._current_row_index, self._current_col_index)
            if key not in self._pending_rowspans:
                break
            self._ensure_row_length(self._current_col_index + 1)
            self._current_row[self._current_col_index] = self._pending_rowspans.pop(key)
            self._current_col_index += 1

    def _advance_to_next_open_column(self) -> None:
        while (self._current_row_index, self._current_col_index) in self._pending_rowspans:
            self._ensure_row_length(self._current_col_index + 1)
            self._current_row[self._current_col_index] = self._pending_rowspans.pop(
                (self._current_row_index, self._current_col_index)
            )
            self._current_col_index += 1

    def _close_cell(self) -> None:
        value = normalize_handbook_body_text("".join(self._current_cell_parts))
        rowspan = max(1, _safe_positive_int(self._current_cell_attrs.get("rowspan")))
        colspan = max(1, _safe_positive_int(self._current_cell_attrs.get("colspan")))
        for offset in range(colspan):
            col_index = self._current_col_index + offset
            self._ensure_row_length(col_index + 1)
            self._current_row[col_index] = value
            for row_offset in range(1, rowspan):
                self._pending_rowspans[(self._current_row_index + row_offset, col_index)] = value
        self._current_col_index += colspan
        self._current_cell_parts = None
        self._current_cell_attrs = {}
        self._apply_rowspans_for_current_row()

    def _ensure_row_length(self, length: int) -> None:
        assert self._current_row is not None
        while len(self._current_row) < length:
            self._current_row.append("")


def _parse_html_table_matrix(html: str) -> list[list[str]] | None:
    parser = _HtmlTableMatrixParser()
    parser.feed(html)
    rows = [row for row in parser.rows if any(cell.strip() for cell in row)]
    if not rows:
        return None
    max_width = max(len(row) for row in rows)
    return [row + [""] * (max_width - len(row)) for row in rows]


def _safe_positive_int(value: object) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return 1
    return parsed if parsed > 0 else 1


def _matrix_information_score(matrix: list[list[str]]) -> tuple[int, int, int]:
    row_count = len(matrix)
    max_width = max((len(row) for row in matrix), default=0)
    filled_cells = sum(1 for row in matrix for cell in row if cell.strip())
    return (filled_cells, row_count, max_width)


def _split_article_line(text: str) -> tuple[str | None, str]:
    match = ARTICLE_PREFIX_RE.match(text)
    if match is None:
        return None, ""
    return _normalize_article_label(match.group("label")), normalize_handbook_body_text(match.group("rest"))


def _is_section_heading(text: str) -> bool:
    return bool(SECTION_HEADING_RE.match(text))


def _looks_like_policy_doc_no(text: str) -> bool:
    return bool(POLICY_DOC_NO_RE.match(_normalize_policy_doc_no(text)))


def _normalize_policy_doc_no(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    normalized = re.sub(r"\s*([\[〔])\s*", r"\1", normalized)
    normalized = re.sub(r"\s*([\]〕])\s*", r"\1", normalized)
    normalized = re.sub(r"(?<=[\]〕])\s+(?=\d)", "", normalized)
    return normalized


def _normalize_section_heading(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    match = SECTION_LABEL_RE.match(normalized)
    if match is None:
        return normalized
    label = match.group("label")
    rest = normalize_handbook_body_text(match.group("rest"))
    return label if not rest else f"{label} {rest}"


def _section_heading_rank(text: str) -> int:
    normalized = _normalize_section_heading(text)
    if normalized.startswith("第") and normalized.endswith("编"):
        return 1
    if normalized.startswith("第") and "章" in normalized[:8]:
        return 2
    if normalized.startswith("第") and "节" in normalized[:8]:
        return 3
    return 2


def _normalize_article_label(value: str) -> str:
    normalized = normalize_handbook_body_text(value)
    return re.sub(r"\s+", "", normalized)


def _looks_like_list_entry(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if LIST_ENTRY_PHONE_RE.search(normalized):
        return True
    return bool(LIST_ENTRY_TWO_FIELD_RE.match(normalized))


def _looks_like_list_section_heading(text: str, next_text: str | None) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or next_text is None:
        return False
    if _split_article_line(normalized)[0] is not None:
        return False
    if _is_section_heading(normalized):
        return False
    if LIST_ENTRY_PHONE_RE.search(normalized):
        return False
    if len(normalized) > 24:
        return False
    if re.search(r"[，。；：！？]", normalized):
        return False
    return _looks_like_list_entry(next_text)


def _next_content_text(rows: list[dict[str, object]], start_index: int) -> str | None:
    for row in rows[start_index:]:
        if str(row.get("row_type") or "") == "table":
            continue
        text = _row_text(row)
        if text:
            return text
    return None


def _looks_like_table_context(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if normalized.endswith(("：", ":")):
        return True
    return bool(re.match(r"^[（(][一二三四五六七八九十0-9]+[)）]", normalized))


def _project_phone_table_policy_pages(
    *,
    row: dict[str, object],
    page_start: int,
    page_end: int,
) -> list[dict[str, object]]:
    table_matrix = _normalize_table_matrix(
        html=row.get("html"),
        table_cells=row.get("table_cells"),
    )
    if not table_matrix or len(table_matrix) < 2:
        return []
    header = [normalize_handbook_body_text(cell) for cell in table_matrix[0]]
    if len(header) < 4 or set(header[:4]) != PHONE_HEADER_LABELS:
        return []

    entries: list[tuple[str, str]] = []
    pending_names: list[str | None] = [None, None]

    def consume_pair(name_index: int, raw_name: object, raw_phone: object) -> None:
        name = normalize_handbook_body_text(str(raw_name))
        phone = normalize_handbook_body_text(str(raw_phone))
        pending_name = pending_names[name_index]
        if name in PHONE_GROUP_HEADINGS and not phone:
            entries.append((name, ""))
            pending_names[name_index] = None
            return
        if name == "办公室" and phone and pending_name:
            entries.append((f"{pending_name}办公室", phone))
            pending_names[name_index] = None
            return
        if name and phone:
            entries.append((name, phone))
            pending_names[name_index] = None
            return
        if name and not phone:
            pending_names[name_index] = name
            return
        if phone and pending_name:
            entries.append((pending_name, phone))
            pending_names[name_index] = None

    for cell_row in table_matrix[1:]:
        consume_pair(0, cell_row[0], cell_row[1])
        consume_pair(1, cell_row[2] if len(cell_row) > 2 else "", cell_row[3] if len(cell_row) > 3 else "")

    if not entries:
        return []

    grouped_lines: dict[str, list[str]] = {heading: [] for heading in PHONE_GROUP_HEADINGS}
    explicit_group_titles: list[str | None] = [None, None]

    for name, phone in entries:
        if name in PHONE_GROUP_HEADINGS and not phone:
            continue
    for cell_row in table_matrix[1:]:
        left_name = normalize_handbook_body_text(str(cell_row[0]))
        left_phone = normalize_handbook_body_text(str(cell_row[1]))
        right_name = normalize_handbook_body_text(str(cell_row[2] if len(cell_row) > 2 else ""))
        right_phone = normalize_handbook_body_text(str(cell_row[3] if len(cell_row) > 3 else ""))
        if left_name in PHONE_GROUP_HEADINGS and not left_phone:
            explicit_group_titles[0] = left_name
        if right_name in PHONE_GROUP_HEADINGS and not right_phone:
            explicit_group_titles[1] = right_name

    for name, phone in entries:
        if name in PHONE_GROUP_HEADINGS and not phone:
            continue
        if phone:
            inferred_group = _infer_phone_group(name)
            grouped_lines[inferred_group].append(f"{name} {phone}")

    groups = [(group_title, grouped_lines[group_title]) for group_title in PHONE_GROUP_HEADINGS if grouped_lines[group_title]]
    if not groups:
        return []

    return [
        {
            "kind": "policy_page",
            "text": normalize_handbook_body_text("\n".join(lines)),
            "page_start": page_start,
            "page_end": page_end,
            "section_path": (group_title,),
        }
        for group_title, lines in groups
    ]


def _infer_phone_group(name: str) -> str:
    for group_title, keywords in PHONE_GROUP_KEYWORDS:
        if any(keyword in name for keyword in keywords):
            return group_title
    return "校级办公与公共服务"


def _escape_yaml_string(value: str) -> str:
    return value.replace("'", "''")


def _coerce_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(value)
    return None
