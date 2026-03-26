from __future__ import annotations

from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import json
import re
import unicodedata

from campus_ingestion_core.chunking import serialize_table_unit_text
from campus_ingestion_core.handbook_article_structure import (
    is_title_like_heading,
    normalize_article_body_structure,
)
from campus_ingestion_core.handbook_structure import classify_structural_heading
from campus_ingestion_core.split_manifest import SplitManifestDocument


ARTICLE_PREFIX_RE = re.compile(
    r"^(?P<label>第\s*[0-9一二三四五六七八九十百千万〇零两]+\s*条)\s*(?P<rest>.*)$"
)
POLICY_DOC_NO_RE = re.compile(r"^[^\n]{0,40}(?:〔|\[)\d{4}(?:〕|\])\d+号$")
TITLE_VARIANT_SUFFIX_RE = re.compile(r"(?:[(（](?:修订|试行|暂行)[)）]|修订|试行|暂行)$")
LIST_ENTRY_PHONE_RE = re.compile(r"\d{5,}")
LIST_ENTRY_TWO_FIELD_RE = re.compile(r"^[^\s，。；：！？]{1,24}\s+[^\s，。；：！？]{1,24}$")
INLINE_ENUMERATED_PROVISION_RE = re.compile(r"^[一二三四五六七八九十百千万〇零两]+、.+[。；！？]$")
INLINE_ENUMERATED_HEADING_RE = re.compile(r"^[一二三四五六七八九十百千万〇零两]+、.+$")
INLINE_ENUMERATED_LABEL_RE = re.compile(r"^(?P<label>[一二三四五六七八九十百千万〇零两]+)、(?P<body>.+)$")
TOP_LEVEL_ENUMERATED_RE = re.compile(r"^(?:[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十百千万〇零两]+、)")
INLINE_LIST_MARKER_RE = re.compile(
    r"^(?P<label>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]))\s*(?P<body>.+)$"
)
INLINE_OCR_REFERENCE_MARKER_RE = re.compile(
    r"(?:(?<=^)|(?<=[\u4e00-\u9fff0-9,，;；:：、()（）]))\[(?:0|[1-9]\d?)\](?=$|[\u4e00-\u9fffA-Za-z0-9(（])"
)
STRUCTURAL_LINE_RE = re.compile(
    r"^(?:第\s*[0-9一二三四五六七八九十百千万〇零两]+\s*条|第[一二三四五六七八九十百千万〇零两0-9]+部分|"
    r"第[一二三四五六七八九十百千万〇零两]+[章节编]|[一二三四五六七八九十百千万〇零两]+、|"
    r"[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[0-9]+[.、])"
)
DATE_LINE_RE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日$")
LIST_SECTION_RANK = 7
POLICY_LEAF_SECTION_RANK = LIST_SECTION_RANK + 1
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
CLOSING_SECTION_KEYWORDS = ("附则", "说明", "实施细则", "补充规定")
TERMINAL_PROVISION_KEYWORDS = (
    "负责解释",
    "负责施行",
    "自发布之日起实施",
    "自发布之日起施行",
    "自印发之日起实施",
    "自印发之日起施行",
    "自公布之日起实施",
    "自公布之日起施行",
    "自发布之日起执行",
    "另行通知",
    "同时废止",
)
DATED_EFFECTIVE_CLAUSE_RE = re.compile(
    r"^(?:本办法|本规定|本细则|本制度|本通知).{0,24}自\d{4}年\d{1,2}月\d{1,2}日起(?:开始)?(?:实施|施行|执行)[。；]?$"
)
GENERIC_TABLE_PROJECT_LABEL = "项目"
FORM_TABLE_CAPTION_KEYWORDS = ("申请表", "审批表", "登记表", "备案表", "信息表")
FORM_TABLE_FIELD_KEYWORDS = (
    "本人情况",
    "学生本人基本情况",
    "家庭经济情况",
    "家庭经济详细情况",
    "家庭住址",
    "身份证号码",
    "政治面貌",
    "出生年月",
    "入学时间",
    "农行卡号",
    "邮政编码",
    "家庭户口",
    "人均月收入",
    "收入来源",
    "工作单位及职务",
    "火车到站站名",
    "民主评议",
    "推荐档次",
    "认定决定",
    "认定结果",
    "户口类型",
    "认定理由",
    "学生陈述申请认定理由",
    "本人联系电话",
    "家庭人均年收入",
)
FORM_TABLE_SECTION_KEYWORDS = (
    "学生本人基本情况",
    "家庭经济情况",
    "学生陈述申请认定理由",
    "民主评议",
    "认定决定",
    "认定结果",
    "报送日期",
    "本人联系电话",
    "家庭经济详细情况",
)
FORM_TABLE_SIGNATURE_KEYWORDS = ("签字", "签章", "盖章", "报送日期", "联系电话")
FORM_TABLE_CHECKBOX_MARKERS = ("☐", "□", "■", "✓", "√")
TABLE_CONTEXT_INTRO_PHRASES = (
    "按以下方式",
    "按下列方式",
    "按下列标准",
    "如下表",
    "见下表",
    "具体如下",
    "对应关系",
)
DECORATIVE_TABLE_KEYWORDS = (
    "照片",
    "骑缝章",
    "盖章",
    "签字",
    "签章",
)
SHORT_HEADING_BODY_STARTERS = (
    "中央民族大学",
    "学生需要",
    "参加",
    "学校",
    "学生",
    "对退役",
    "无",
)
SHORT_HEADING_FORBIDDEN_FRAGMENTS = (
    "在",
    "由",
    "按",
    "根据",
    "按照",
    "可以",
    "必须",
    "应当",
    "不得",
    "负责",
    "组织",
    "进行",
    "提交",
    "完成",
    "办理",
    "取得",
    "录入",
    "审核",
    "确定",
    "通知",
    "采用",
    "掌握",
    "遵守",
    "受到",
)
SHORT_HEADING_PREFIX_RE = re.compile(r"^[\u4e00-\u9fff、与及和\-]{2,12}$")
CITATION_CONTINUATION_START_CHARS = {"[", "〔", "(", "（", "《", "“", "‘", '"', "'"}
SHORT_HEADING_WHITELIST = {
    "候选人公示",
    "学生申请",
    "毕业、结业与肄业",
    "报名审核",
    "公示",
}
SHORT_HEADING_SEMANTIC_SUFFIXES = (
    "申请",
    "审核",
    "初评",
    "公示",
    "报名",
    "认定",
    "考核",
    "名单",
    "方式",
    "要求",
    "条件",
    "原则",
    "标准",
    "程序",
    "步骤",
    "时间",
    "结果",
    "办法",
    "流程",
    "管理",
    "处理",
    "分配",
    "实施",
    "说明",
    "理由",
    "意见",
    "助学",
    "奖学金",
    "助学金",
    "减免",
    "代偿",
    "留学",
    "注册",
    "资助",
    "服务",
    "选拔",
    "通知",
)
NOTE_LINE_PREFIXES = ("备注:", "备注：", "注:", "注：")
BODY_SENTENCE_STARTERS = (
    "一般",
    "兹证明",
    "原则",
    "学生",
    "各院系",
    "学校",
    "用于",
    "应征",
    "院系",
    "教务处",
    "学院",
    "根据",
    "按照",
    "自愿",
    "符合",
    "申请",
    "应当",
    "可以",
    "不得",
    "负责",
    "组织",
    "进行",
    "完成",
    "办理",
    "确定",
    "公布",
    "公示",
)
DOC_NO_PARENTHESES_REPAIR_RE = re.compile(
    r"(?P<open>[(（])"
    r"(?P<body>[^()（）\n]{0,120}?"
    r"(?:民大校发|民大学发|民大党发|中发|教高)[^()（）\n]{0,40}?号)"
    r"(?P<suffix>[的并和及，。；、])"
)
APPENDIX_MARKERS = ("附件", "附表", "附录")
SOFT_WRAP_CONTINUATION_CHARS = frozenset({"、", "，", ","})
APPENDIX_INLINE_TITLE_SUFFIXES = ("证明", "申请表", "审批表", "登记表", "备案表", "信息表")
ATTACHMENT_TITLE_SUFFIXES = APPENDIX_INLINE_TITLE_SUFFIXES + ("统计表", "调查表", "汇总表", "明细表")
NAVIGATION_SECTION_KEYWORDS = ("流程", "程序", "步骤")
ANCILLARY_NOTE_SUFFIXES = ("制表",)
NAVIGATION_LEAF_FORBIDDEN_FRAGMENTS = (
    "应当",
    "不得",
    "可以",
    "必须",
    "负责",
    "根据",
    "按照",
)
LEAF_SECTION_PUNCTUATION_RE = re.compile(r"[，,。；;：:！？!?]")


@dataclass(frozen=True, slots=True)
class HandbookCleanupResult:
    title: str
    doc_id: str
    version_id: str
    metadata: dict[str, object]
    canonical_markdown: str
    document_units: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class NormalizedHandbookTable:
    matrix: tuple[tuple[str, ...], ...]
    header_rows: tuple[tuple[str, ...], ...]
    body_rows: tuple[tuple[str, ...], ...]
    column_paths: tuple[str, ...]
    header_line: str
    row_lines: tuple[str, ...]
    caption_lines: tuple[str, ...]
    note_lines: tuple[str, ...]


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
    events, policy_doc_no, preface_text = _build_document_events(content_rows)

    metadata: dict[str, object] = {
        "title": title,
        "source_doc": source_doc,
        "page_start": manifest_document.page_start,
        "page_end": manifest_document.page_end,
        "handbook_section": manifest_document.handbook_section,
    }
    if policy_doc_no is not None:
        metadata["policy_doc_no"] = policy_doc_no

    canonical_body = _build_canonical_body(events, policy_doc_no=policy_doc_no, preface_text=preface_text)
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
        title=title,
        policy_doc_no=policy_doc_no,
        preface_text=preface_text,
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
    projected_rows = _project_manifest_rows(structured_rows, manifest_document)
    if not projected_rows:
        raise ValueError(f"manifest document {manifest_document.document_id} does not match any source rows")
    if _find_title_anchor_index(
        projected_rows,
        title=manifest_document.title,
    ) is not None:
        return
    candidate_title = extract_handbook_title_candidate(
        structured_rows=projected_rows,
        first_page=manifest_document.page_start,
    )
    if candidate_title is None or _is_placeholder_title(manifest_document.title):
        raise ValueError(
            "manifest document "
            f"{manifest_document.document_id} missing title anchor for {normalize_handbook_title(manifest_document.title)!r}"
        )
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
    normalized = _normalize_body_fragment(value)
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    merged_lines = _merge_broken_body_lines([line for line in lines if line])
    normalized_lines = [
        _repair_known_ocr_phrase_errors(
            _repair_missing_parenthetical_doc_no_closure(_normalize_structural_body_glue(line))
        )
        for line in merged_lines
    ]
    deduplicated = _deduplicate_boundary_overlap_lines(normalized_lines)
    return "\n".join(deduplicated)


def normalize_handbook_article_body_text(value: str) -> str:
    normalized = normalize_handbook_body_text(value)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    merged_lines = _merge_article_soft_wrapped_lines(lines)
    normalized_article_lines = [_normalize_article_heading_body_glue(line) for line in merged_lines]
    return normalize_article_body_structure("\n".join(normalized_article_lines))


def _normalize_body_fragment(value: str) -> str:
    return unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _merge_broken_body_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        if merged and _should_merge_broken_line(merged[-1], line):
            merged[-1] = f"{merged[-1]}{line}"
            continue
        merged.append(line)
    return merged


def _merge_article_soft_wrapped_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        if merged and _should_merge_article_soft_wrap(merged[-1], line):
            merged[-1] = f"{merged[-1]}{line}"
            continue
        merged.append(line)
    return merged


def _should_merge_broken_line(previous: str, current: str) -> bool:
    if not previous or not current:
        return False
    if previous.lstrip().startswith("#") or current.lstrip().startswith("#"):
        return False
    if previous.endswith(("。", "！", "？", "；", "：", ":")):
        return False
    if _looks_like_front_matter_line(previous) or _looks_like_front_matter_line(current):
        return False
    if _looks_like_structural_line(current):
        return False
    if _looks_like_formula_line(previous) or _looks_like_formula_line(current):
        return False
    if _looks_like_citation_continuation(previous, current):
        return True
    if _looks_like_intended_structural_split(previous, current):
        return False
    if _looks_like_heading_note_boundary(previous, current):
        return False
    previous_tail = previous[-1]
    current_head = current[0]
    if previous_tail in SOFT_WRAP_CONTINUATION_CHARS and _is_sentence_char(current_head):
        return True
    if not (_is_sentence_char(previous_tail) and _is_sentence_char(current_head)):
        return False
    return True


def _should_merge_article_soft_wrap(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if _looks_like_front_matter_line(normalized_previous) or _looks_like_front_matter_line(normalized_current):
        return False
    if _looks_like_formula_line(normalized_previous) or _looks_like_formula_line(normalized_current):
        return False
    if _looks_like_citation_continuation(normalized_previous, normalized_current):
        return True
    if _looks_like_article_structure_line(normalized_current):
        return False
    if _looks_like_intended_structural_split(normalized_previous, normalized_current):
        return False
    if _looks_like_heading_note_boundary(normalized_previous, normalized_current):
        return False
    if normalized_previous.endswith(("。", "！", "？", "；", "：", ":")):
        return False
    if normalized_previous[-1] in SOFT_WRAP_CONTINUATION_CHARS and _is_sentence_char(normalized_current[0]):
        return True
    if not (_is_sentence_char(normalized_previous[-1]) and _is_sentence_char(normalized_current[0])):
        return False
    if len(normalized_previous) <= 2:
        return False
    return True


def _looks_like_article_structure_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    return bool(
        ARTICLE_PREFIX_RE.match(normalized)
        or TOP_LEVEL_ENUMERATED_RE.match(normalized)
        or INLINE_LIST_MARKER_RE.match(normalized)
    )


def _looks_like_intended_structural_split(previous: str, current: str) -> bool:
    normalized_previous = _heading_fragment_candidate(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if len(normalized_current) < 8:
        return False
    if not _is_short_heading_fragment(normalized_previous) and not _is_semantic_heading_fragment(normalized_previous):
        return False
    if not _looks_like_semantic_short_heading_fragment(normalized_previous):
        return False
    if normalized_current.startswith(normalized_previous):
        trailing = normalized_current[len(normalized_previous) :].lstrip()
        if trailing and _looks_like_title_like_heading_remainder(trailing):
            return True
    return any(normalized_current.startswith(starter) for starter in BODY_SENTENCE_STARTERS + SHORT_HEADING_BODY_STARTERS)


def _heading_fragment_candidate(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    article_match = ARTICLE_PREFIX_RE.match(normalized)
    if article_match is not None:
        return article_match.group("rest").strip()
    list_match = INLINE_LIST_MARKER_RE.match(normalized)
    if list_match is not None:
        return list_match.group("body").strip()
    return normalized


def _looks_like_heading_note_boundary(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if not normalized_current.startswith(NOTE_LINE_PREFIXES):
        return False
    return _normalize_heading_tail_ocr_error(normalized_previous) is not None or is_title_like_heading(normalized_previous)


def _looks_like_citation_continuation(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    current_head = normalized_current[0]
    if current_head in CITATION_CONTINUATION_START_CHARS and _has_unclosed_citation_context(normalized_previous):
        return True
    return normalized_previous.endswith(("民大校发", "民大学发", "民大党发", "中发", "教高")) and (
        current_head in CITATION_CONTINUATION_START_CHARS or current_head.isdigit()
    )


def _has_unclosed_citation_context(text: str) -> bool:
    pairs = (("(", ")"), ("（", "）"), ("《", "》"), ("[", "]"), ("〔", "〕"), ("“", "”"), ("‘", "’"))
    return any(text.count(left) > text.count(right) for left, right in pairs)


def _looks_like_structural_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    return bool(normalized and STRUCTURAL_LINE_RE.match(normalized))


def _looks_like_front_matter_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    return bool(DATE_LINE_RE.match(normalized) or POLICY_DOC_NO_RE.match(normalized))


def _looks_like_formula_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if "\\sum" in normalized or "$" in normalized:
        return True
    if "=" not in normalized:
        return False
    operator_count = sum(normalized.count(marker) for marker in ("=", "×", "÷", "/", "+", "-", "<", ">"))
    if operator_count >= 2:
        return True
    return False


def _is_sentence_char(value: str) -> bool:
    return value.isalnum() or ("\u4e00" <= value <= "\u9fff") or value in {"%", ")", "）", "》", "”", "’", "]", "〕"}


def _normalize_structural_body_glue(text: str) -> str:
    normalized = " ".join(_normalize_body_fragment(text).split()).strip()
    if not normalized:
        return ""
    normalized_heading_tail = _normalize_heading_tail_ocr_error(normalized)
    if normalized_heading_tail is not None:
        return normalized_heading_tail
    list_match = INLINE_LIST_MARKER_RE.match(normalized)
    if list_match is None:
        return normalized
    body = list_match.group("body").strip()
    split_body = _split_short_heading_from_body(body)
    if split_body is None:
        return normalized
    return f"{list_match.group('label').strip()} {split_body[0]}\n{split_body[1]}"


def _split_short_heading_from_body(body: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(body)
    if not normalized or "\n" in normalized:
        return None
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    for starter in SHORT_HEADING_BODY_STARTERS:
        marker_index = normalized.find(starter)
        if marker_index <= 0:
            continue
        heading = normalized[:marker_index].strip()
        remainder = normalized[marker_index:].strip()
        if len(remainder) < 8:
            continue
        if not _is_short_heading_fragment(heading):
            continue
        if not _looks_like_semantic_short_heading_fragment(heading):
            continue
        overlap = _find_boundary_overlap(heading, remainder)
        if overlap:
            remainder = remainder[len(overlap) :].lstrip()
        return heading, remainder
    return None


def _split_repeated_short_heading_from_body(body: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(body)
    if not normalized or "\n" in normalized:
        return None
    max_heading_length = min(len(normalized) // 2, 12)
    for heading_length in range(3, max_heading_length + 1):
        heading = normalized[:heading_length].strip()
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        if not normalized.startswith(f"{heading}{heading}"):
            continue
        remainder = normalized[heading_length:].lstrip()
        trailing = remainder[len(heading) :].lstrip()
        if not trailing or not _looks_like_title_like_heading_remainder(trailing):
            continue
        return heading, trailing
    return None


def _normalize_article_heading_body_glue(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    article_match = ARTICLE_PREFIX_RE.match(normalized)
    if article_match is not None:
        article_label = _normalize_article_label(article_match.group("label"))
        article_rest = " ".join(_normalize_body_fragment(article_match.group("rest")).split()).strip()
        split_body = _split_title_like_heading_body(article_rest)
        if split_body is None:
            return normalized
        return f"{article_label} {split_body[0]}\n{split_body[1]}"
    list_match = INLINE_LIST_MARKER_RE.match(normalized)
    if list_match is not None:
        list_label = list_match.group("label").strip()
        list_rest = " ".join(_normalize_body_fragment(list_match.group("body")).split()).strip()
        split_body = _split_extended_inline_list_heading_body(list_rest)
        if split_body is None:
            return normalized
        return f"{list_label} {split_body[0]}\n{split_body[1]}"
    split_body = _split_title_like_heading_body(normalized)
    if split_body is None:
        return normalized
    return f"{split_body[0]}\n{split_body[1]}"


def _split_glued_structural_heading(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    match = INLINE_ENUMERATED_LABEL_RE.match(normalized)
    if match is None:
        return None
    split_body = _split_title_like_heading_body(match.group("body").strip())
    if split_body is None:
        return None
    heading = f"{match.group('label').strip()}、{split_body[0]}"
    remainder = split_body[1].strip()
    if not heading or not remainder:
        return None
    return heading, remainder


def _split_title_like_heading_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    semantic_heading = _split_semantic_heading_from_body(normalized)
    if semantic_heading is not None:
        return semantic_heading
    plain_heading = _split_plain_heading_from_body(normalized)
    if plain_heading is not None:
        return plain_heading
    marker_re = re.compile(r"(?P<marker>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]))")
    for match in marker_re.finditer(normalized):
        heading = normalized[: match.start("marker")].strip()
        remainder = normalized[match.start("marker") :].lstrip()
        if not heading or not remainder:
            continue
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        return heading, remainder
    max_heading_length = min(len(normalized) - 1, 24)
    for split_index in range(2, max_heading_length + 1):
        heading = normalized[:split_index].strip()
        remainder = normalized[split_index:].lstrip()
        if not heading or not remainder:
            continue
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        overlap = _shared_cjk_prefix(heading, remainder)
        if len(overlap) < max(2, len(heading) // 2):
            continue
        remainder_after_overlap = remainder[len(overlap) :].lstrip()
        if not _looks_like_title_like_heading_overlap_remainder(remainder_after_overlap):
            continue
        return heading, remainder
    return None


def _split_plain_heading_from_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    for starter in BODY_SENTENCE_STARTERS:
        marker_index = normalized.find(starter)
        if marker_index <= 0:
            continue
        heading = normalized[:marker_index].strip()
        remainder = normalized[marker_index:].strip()
        if len(remainder) < 8:
            continue
        if len(heading) < 4 and heading not in SHORT_HEADING_WHITELIST:
            continue
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        if not _looks_like_semantic_short_heading_fragment(heading):
            continue
        overlap = _find_boundary_overlap(heading, remainder)
        if overlap:
            remainder = remainder[len(overlap) :].lstrip()
        return heading, remainder
    return None


def _split_semantic_heading_from_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    if _looks_like_navigation_section_heading_candidate(normalized):
        return None
    max_heading_length = min(len(normalized) - 1, 24)
    for split_index in range(3, max_heading_length + 1):
        heading = normalized[:split_index].strip()
        remainder = normalized[split_index:].lstrip()
        if not heading or not remainder:
            continue
        if not _is_semantic_heading_fragment(heading):
            continue
        if _looks_like_title_like_heading_remainder(remainder):
            return heading, remainder
        overlap = _shared_cjk_prefix(heading, remainder)
        if len(overlap) < max(4, min(8, len(heading) // 2)):
            continue
        remainder_after_overlap = remainder[len(overlap) :].lstrip()
        if _looks_like_title_like_heading_overlap_remainder(remainder_after_overlap):
            return heading, remainder
    return None


def _split_extended_inline_list_heading_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    semantic_heading = _split_semantic_heading_from_body(normalized)
    if semantic_heading is None:
        return None
    heading, remainder = semantic_heading
    if len(heading) >= 5:
        return heading, remainder
    if len(_shared_cjk_prefix(heading, remainder)) >= 4:
        return heading, remainder
    return None


def _looks_like_navigation_section_heading_candidate(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    body = INLINE_LIST_MARKER_RE.match(normalized).group("body").strip() if INLINE_LIST_MARKER_RE.match(normalized) else normalized
    if not body:
        return False
    return any(body.endswith(keyword) for keyword in NAVIGATION_SECTION_KEYWORDS)


def _looks_like_title_like_heading_remainder(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if INLINE_LIST_MARKER_RE.match(normalized):
        return True
    if len(normalized) < 4:
        return False
    return any(normalized.startswith(starter) for starter in BODY_SENTENCE_STARTERS)


def _looks_like_title_like_heading_overlap_remainder(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if _looks_like_title_like_heading_remainder(normalized):
        return True
    return normalized.startswith("的") and len(normalized) >= 4


def _shared_cjk_prefix(left: str, right: str) -> str:
    shared_chars: list[str] = []
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        if not re.fullmatch(r"[\u4e00-\u9fff]", left_char):
            break
        shared_chars.append(left_char)
    return "".join(shared_chars)


def _is_short_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    if len(normalized) < 3:
        return False
    if any(fragment in normalized for fragment in SHORT_HEADING_FORBIDDEN_FRAGMENTS):
        return False
    if normalized.endswith(("的", "地", "得", "了", "时", "后", "前", "和", "及")):
        return False
    return bool(SHORT_HEADING_PREFIX_RE.fullmatch(normalized))


def _is_semantic_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    if len(normalized) < 3 or len(normalized) > 24:
        return False
    if normalized.endswith(("的", "地", "得", "了", "时", "后", "前", "和", "及")):
        return False
    if not re.fullmatch(r"[\u4e00-\u9fff、与及和\-]{3,24}", normalized):
        return False
    if any(fragment in normalized for fragment in SHORT_HEADING_FORBIDDEN_FRAGMENTS):
        return _looks_like_semantic_short_heading_fragment(normalized)
    return _looks_like_semantic_short_heading_fragment(normalized)


def _looks_like_semantic_short_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    return any(normalized.endswith(suffix) for suffix in SHORT_HEADING_SEMANTIC_SUFFIXES)


def _deduplicate_boundary_overlap_lines(lines: list[str]) -> list[str]:
    deduplicated: list[str] = []
    for line in lines:
        if not deduplicated:
            deduplicated.append(line)
            continue
        previous = deduplicated[-1]
        deduplicated[-1] = _deduplicate_adjacent_overlap(previous, line)
    return deduplicated


def _deduplicate_adjacent_overlap(previous: str, current: str) -> str:
    if not previous or not current:
        return previous + ("\n" + current if current else "")
    previous_line = previous.rsplit("\n", 1)[-1].strip()
    current_line = current.split("\n", 1)[0].strip()
    if previous_line and current_line:
        overlap = _find_boundary_overlap(previous_line, current_line)
        if overlap:
            current = current[len(overlap) :].lstrip()
    return f"{previous}\n{current}" if current else previous


def _find_boundary_overlap(previous: str, current: str) -> str:
    max_overlap = min(len(previous), len(current), 8)
    for overlap_length in range(max_overlap, 1, -1):
        suffix = previous[-overlap_length:]
        prefix = current[:overlap_length]
        if suffix != prefix:
            continue
        if not re.fullmatch(r"[\u4e00-\u9fff]{2,8}", suffix):
            continue
        if len(previous) == overlap_length and len(current) > overlap_length and current[overlap_length : overlap_length + 1] in {"申", "需"}:
            continue
        return suffix
    return ""


def _normalize_heading_tail_ocr_error(text: str) -> str | None:
    normalized = " ".join(_normalize_body_fragment(text).split()).strip()
    for prefix in NOTE_LINE_PREFIXES:
        marker = f"准{prefix}"
        marker_index = normalized.find(marker)
        if marker_index <= 0:
            continue
        heading = normalized[: marker_index + 1].strip()
        remainder = normalized[marker_index + 1 :].strip()
        repaired_heading = _strip_repeated_heading_tail_char(heading)
        if repaired_heading == heading or not is_title_like_heading(repaired_heading):
            continue
        return f"{repaired_heading}\n{remainder}"
    return None


def _repair_missing_parenthetical_doc_no_closure(text: str) -> str:
    repaired_lines: list[str] = []
    for raw_line in _normalize_body_fragment(text).splitlines():
        normalized = " ".join(raw_line.split()).strip()
        if not normalized or not _has_unclosed_citation_context(normalized):
            repaired_lines.append(normalized)
            continue

        repaired = normalized
        while True:
            match = DOC_NO_PARENTHESES_REPAIR_RE.search(repaired)
            if match is None:
                break
            closing = ")" if match.group("open") == "(" else "）"
            repaired = f"{repaired[:match.start('suffix')]}{closing}{repaired[match.start('suffix'):]}"
            if not _has_unclosed_citation_context(repaired):
                break
        repaired_lines.append(repaired)
    return "\n".join(line for line in repaired_lines if line)


def _repair_known_ocr_phrase_errors(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    normalized = _strip_inline_ocr_reference_markers(normalized)
    normalized = normalized.replace("允许使用永恒的所有电器", "允许使用的所有电器")
    normalized = normalized.replace("私自将违规电器带入室内着", "私自将违规电器带入室内者")
    normalized = normalized.replace("一法追究法律责任", "依法追究法律责任")
    normalized = normalized.replace("志愿志愿服务", "志愿服务")
    normalized = normalized.replace("助学服务中心中心", "助学服务中心")
    return normalized


def _strip_inline_ocr_reference_markers(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    return INLINE_OCR_REFERENCE_MARKER_RE.sub("", normalized)


def _strip_repeated_heading_tail_char(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if len(normalized) < 2:
        return normalized
    if normalized[-1] != normalized[-2]:
        return normalized
    candidate = normalized[:-1].strip()
    return candidate


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
        _coerce_int(row.get("reading_order")) or _coerce_int(row.get("row_index")) or 0,
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
    title_anchor_index = _find_title_anchor_index(
        projected_rows,
        title=title,
    )
    if title_anchor_index is None:
        raise ValueError(f"handbook document cleanup missing title anchor for {title!r}")
    filtered: list[dict[str, object]] = []
    title_consumed = False
    normalized_title = _normalize_title_for_match(title)
    anchor_page = _coerce_int(projected_rows[title_anchor_index].get("page_start"))
    for row in projected_rows[title_anchor_index:]:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") in {"header", "footer", "page_number"}:
            continue
        text = _row_text(row)
        if not text and str(row.get("row_type") or "") != "table":
            continue
        if (
            not title_consumed
            and _normalize_title_for_match(text) == normalized_title
        ):
            title_consumed = True
            continue
        if (
            title_consumed
            and anchor_page is not None
            and _coerce_int(row.get("page_start")) == anchor_page
            and _looks_like_title_variant_suffix_line(text)
        ):
            continue
        filtered.append(row)
    return filtered


def _find_title_anchor_index(
    projected_rows: list[dict[str, object]],
    *,
    title: str,
) -> int | None:
    normalized_title = _normalize_title_for_match(title)
    if not normalized_title:
        return None
    for index, row in enumerate(projected_rows):
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") in {"header", "footer", "page_number", "table"}:
            continue
        text = _row_text(row)
        if not text:
            continue
        if _normalize_title_for_match(text) == normalized_title:
            return index
    return None


def _build_document_events(content_rows: list[dict[str, object]]) -> tuple[list[dict[str, object]], str | None, str | None]:
    content_rows = _expand_multiline_paragraph_rows(content_rows)
    policy_doc_no: str | None = None
    current_section_nodes: list[tuple[int, str]] = []
    preface_parts: list[str] = []
    events: list[dict[str, object]] = []
    current_article: dict[str, object] | None = None
    current_policy_page: dict[str, object] | None = None
    active_article_context: dict[str, object] | None = None
    pending_table_context: str | None = None
    pending_form_table_legend_skip = False
    appendix_context_active = False
    pending_appendix_marker_only = False

    def flush_article() -> None:
        nonlocal current_article
        if current_article is None:
            return
        current_article["text"] = normalize_handbook_article_body_text("\n".join(current_article.pop("parts")))
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

    def append_section(*, text: str, rank: int = LIST_SECTION_RANK) -> None:
        nonlocal current_section_nodes
        normalized_heading = normalize_handbook_body_text(text)
        if not normalized_heading or _looks_like_appendix_leaf_section_heading(normalized_heading):
            return
        current_section_nodes = [node for node in current_section_nodes if node[0] < rank]
        current_section_nodes.append((rank, normalized_heading))
        events.append(
            {
                "kind": "section",
                "text": normalized_heading,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
        )

    for row_index, row in enumerate(content_rows):
        row_type = str(row.get("row_type") or "")
        text = _row_text(row)
        page_start = _coerce_int(row.get("page_start")) or 0
        page_end = _coerce_int(row.get("page_end")) or page_start
        next_text = _next_content_text(content_rows, row_index + 1)
        next_row = _next_nonblank_row(content_rows, row_index + 1)
        followed_by_table = _has_following_table_before_content_break(content_rows, row_index + 1)
        glued_structural_heading = _split_glued_structural_heading(text) if text else None

        if row_type == "table":
            roster_policy_pages = _project_phone_table_policy_pages(row=row, page_start=page_start, page_end=page_end)
            if roster_policy_pages:
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                pending_form_table_legend_skip = False
                appendix_context_active = False
                pending_appendix_marker_only = False
                events.extend(roster_policy_pages)
            policy_page_table_context: str | None = None
            if current_policy_page is not None:
                candidate_policy_text = normalize_handbook_body_text("\n".join(current_policy_page["parts"]))
                if appendix_context_active and _should_attach_policy_page_to_following_table(candidate_policy_text):
                    policy_page_table_context = candidate_policy_text
                    current_policy_page = None
                else:
                    flush_policy_page()
            table_context = pending_table_context if active_article_context is not None else policy_page_table_context
            table_matrix = _normalize_table_matrix(
                html=row.get("html"),
                table_cells=row.get("table_cells"),
            )
            form_like_table = False
            if table_matrix:
                normalized_table_matrix = [
                    tuple(normalize_handbook_body_text(cell) for cell in table_row)
                    for table_row in table_matrix
                ]
                caption_text = normalize_handbook_body_text(table_context) if isinstance(table_context, str) else ""
                form_like_table = _looks_like_form_table(normalized_table_matrix, caption_text=caption_text)
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
            pending_form_table_legend_skip = form_like_table
            pending_table_context = None
            continue

        if not text:
            continue

        if appendix_context_active and _looks_like_form_template_legend(text):
            continue
        if pending_form_table_legend_skip and _looks_like_form_template_legend(text):
            continue
        if pending_form_table_legend_skip:
            pending_form_table_legend_skip = False

        appendix_heading_title = _extract_appendix_heading_title(text)
        if appendix_heading_title is not None:
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            appendix_context_active = True
            append_section(text=appendix_heading_title)
            continue

        if _looks_like_appendix_marker_only(text):
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            appendix_context_active = True
            pending_appendix_marker_only = True
            continue

        if appendix_context_active and pending_appendix_marker_only:
            normalized_candidate = normalize_handbook_body_text(text)
            if (
                normalized_candidate
                and not _looks_like_appendix_heading(normalized_candidate)
                and (row_type == "heading" or is_title_like_heading(normalized_candidate))
            ):
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(text=normalized_candidate)
                pending_appendix_marker_only = False
                continue
            if normalized_candidate and (
                _looks_like_attachment_title_text(normalized_candidate)
                or _looks_like_appendix_leaf_section_heading(normalized_candidate)
            ):
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(
                    text=_normalize_attachment_heading_text(normalized_candidate),
                    rank=_next_policy_leaf_section_rank(current_section_nodes),
                )
                pending_appendix_marker_only = False
                continue
            appendix_inline_title = _split_appendix_inline_title(text)
            if appendix_inline_title is not None:
                appendix_title, appendix_body = appendix_inline_title
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(text=appendix_title)
                pending_appendix_marker_only = False
                if appendix_body:
                    text = appendix_body
                    next_text = _next_content_text(content_rows, row_index + 1)
                    next_row = _next_nonblank_row(content_rows, row_index + 1)
                else:
                    continue
            else:
                pending_appendix_marker_only = False

        if policy_doc_no is None and _looks_like_policy_doc_no(text):
            policy_doc_no = _normalize_policy_doc_no(text)
            continue

        if glued_structural_heading is not None:
            text = glued_structural_heading[0]
            next_text = glued_structural_heading[1]

        if (
            current_article is None
            and current_section_nodes
            and _looks_like_navigation_policy_leaf(text, current_section_nodes=current_section_nodes)
        ):
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            append_section(text=text, rank=_next_policy_leaf_section_rank(current_section_nodes))
            continue

        structural_heading = classify_structural_heading(
            text=text,
            row_type=row_type,
            next_text=next_text,
        )
        if (
            structural_heading is not None
            and current_article is not None
            and structural_heading.kind in {"enumerated", "enumerated_subsection"}
        ):
            structural_heading = None
        if (
            structural_heading is not None
            and active_article_context is not None
            and pending_table_context is not None
            and followed_by_table
            and structural_heading.kind in {"enumerated", "enumerated_subsection"}
        ):
            structural_heading = None
        if structural_heading is not None:
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            current_section_nodes = [node for node in current_section_nodes if node[0] < structural_heading.rank]
            current_section_nodes.append((structural_heading.rank, structural_heading.text))
            events.append(
                {
                    "kind": "section",
                    "text": structural_heading.text,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            )
            if glued_structural_heading is None:
                continue
            text = glued_structural_heading[1]

        if glued_structural_heading is not None:
            next_text = _next_content_text(content_rows, row_index + 1)
            next_row = _next_nonblank_row(content_rows, row_index + 1)

        if (
            current_policy_page is not None
            and appendix_context_active
            and _should_merge_policy_fragment_into_previous_line(
                fragment=text,
                current_parts=current_policy_page["parts"],
                next_row=next_row,
            )
        ):
            current_policy_page["parts"][-1] = _merge_policy_fragment_into_previous_line(
                current_policy_page["parts"][-1],
                text,
            )
            current_policy_page["page_end"] = page_end
            continue

        terminal_provision = (
            _split_inline_enumerated_provision(text)
            if current_article is None
            and _should_emit_inline_policy_provision(
                text,
                current_section_nodes=current_section_nodes,
                current_policy_page=current_policy_page,
            )
            else None
        )
        if terminal_provision is not None:
            provision_label, normalized_text = terminal_provision
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            current_section_nodes = [node for node in current_section_nodes if node[0] <= 4]
            events.append(
                {
                    "kind": "policy_page",
                    "text": normalized_text,
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                    "provision_label": provision_label,
                }
            )
            continue

        article_label, rest = _split_article_line(text)
        if article_label is not None:
            flush_policy_page()
            flush_article()
            current_section_nodes = [node for node in current_section_nodes if node[0] < LIST_SECTION_RANK]
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
            appendix_context_active = False
            pending_appendix_marker_only = False
            continue

        if current_article is not None and _looks_like_appendix_heading(text):
            flush_article()
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
            pending_table_context = None
            appendix_context_active = True
            continue

        if current_article is not None:
            current_article["parts"].append(text)
            current_article["page_end"] = page_end
            if _looks_like_table_context(text, next_row=next_row, followed_by_table=followed_by_table):
                pending_table_context = text
            elif not (pending_table_context is not None and followed_by_table and row_type == "heading"):
                pending_table_context = None
            continue

        if active_article_context is not None:
            if _looks_like_table_context(text, next_row=next_row, followed_by_table=followed_by_table):
                pending_table_context = text
            elif not (pending_table_context is not None and followed_by_table and row_type == "heading"):
                pending_table_context = None

        if appendix_context_active and _looks_like_table_lead_label(text, next_row=next_row):
            flush_policy_page()
            current_policy_page = {
                "kind": "policy_page",
                "parts": [text],
                "page_start": page_start,
                "page_end": page_end,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
            continue

        if _looks_like_list_section_heading(text, next_text):
            flush_policy_page()
            active_article_context = None
            append_section(text=text)
            continue

        if current_section_nodes and _looks_like_attachment_title_text(text):
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            append_section(
                text=_normalize_attachment_heading_text(text),
                rank=_next_policy_leaf_section_rank(current_section_nodes),
            )
            continue

        if current_section_nodes and _looks_like_ancillary_note_line(text):
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            continue

        if current_policy_page is not None or current_section_nodes or _looks_like_list_entry(text):
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
        appendix_context_active = False
        pending_appendix_marker_only = False
        preface_parts.append(text)

    flush_article()
    flush_policy_page()
    preface_text = normalize_handbook_body_text("\n".join(preface_parts)) if preface_parts else None
    if preface_text and not any(event["kind"] != "section" for event in events):
        events.append(
            {
                "kind": "policy_page",
                "text": preface_text,
                "page_start": _coerce_int(content_rows[0].get("page_start")) or 0,
                "page_end": _coerce_int(content_rows[-1].get("page_end")) or 0,
                "section_path": (),
            },
        )
        preface_text = None

    substantive_events = [event for event in events if event["kind"] != "section"]
    if not substantive_events:
        raise ValueError("handbook document cleanup produced no content units")
    return events, policy_doc_no, preface_text


def _expand_multiline_paragraph_rows(content_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    expanded_rows: list[dict[str, object]] = []
    for row in content_rows:
        if str(row.get("row_type") or "") != "paragraph":
            expanded_rows.append(row)
            continue
        text = _row_text(row)
        if not text or "\n" not in text:
            expanded_rows.append(row)
            continue
        fragments = [line.strip() for line in text.splitlines() if line.strip()]
        if len(fragments) <= 1:
            expanded_rows.append(row)
            continue
        for index, fragment in enumerate(fragments, start=1):
            expanded_row = dict(row)
            expanded_row["row_id"] = f"{row.get('row_id')}-part-{index:02d}"
            expanded_row["text_raw"] = fragment
            expanded_row["text_normalized"] = fragment
            expanded_rows.append(expanded_row)
    return expanded_rows


def _build_canonical_body(
    events: list[dict[str, object]],
    *,
    policy_doc_no: str | None,
    preface_text: str | None,
) -> str:
    parts: list[str] = []
    if preface_text:
        parts.append(preface_text)
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
    title: str,
    policy_doc_no: str | None,
    preface_text: str | None,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    policy_index = 0
    article_index = 0
    table_index = 0
    first_substantive_row = True

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
                        **(
                            {"provision_label": str(event["provision_label"])}
                            if event.get("provision_label") is not None
                            else {}
                        ),
                    },
                    metadata=_build_unit_metadata(
                        title=title,
                        policy_doc_no=policy_doc_no,
                        preface_text=preface_text if first_substantive_row else None,
                    ),
                )
            )
            first_substantive_row = False
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
                    metadata=_build_unit_metadata(
                        title=title,
                        policy_doc_no=policy_doc_no,
                        preface_text=preface_text if first_substantive_row else None,
                    ),
                )
            )
            first_substantive_row = False
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
                    metadata=_build_unit_metadata(
                        title=title,
                        policy_doc_no=policy_doc_no,
                        preface_text=preface_text if first_substantive_row else None,
                    ),
                    html=event.get("html"),
                    table_cells=table_cells,
                )
            )
            first_substantive_row = False
            table_semantics = _build_table_unit_semantics(
                table_cells=table_cells,
                table_context=event.get("table_context"),
            )
            if table_semantics is not None:
                rows.append(
                    _build_structured_unit_row(
                        doc_id=doc_id,
                        version_id=version_id,
                        chunk_id=f"{root_unit_id}-unit",
                        root_unit_id=root_unit_id,
                        unit_type="table_unit",
                        clean_text=serialize_table_unit_text(
                            caption_lines=table_semantics.caption_lines,
                            header_line=table_semantics.header_line,
                            row_lines=table_semantics.row_lines,
                            note_lines=table_semantics.note_lines,
                        ),
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
                        metadata={
                            **_build_unit_metadata(
                                title=title,
                                policy_doc_no=policy_doc_no,
                                preface_text=None,
                            ),
                            "caption_lines": list(table_semantics.caption_lines),
                            "note_lines": list(table_semantics.note_lines),
                            "table_header_rows": [list(row) for row in table_semantics.header_rows],
                            "table_body_rows": [list(row) for row in table_semantics.body_rows],
                            "table_column_paths": list(table_semantics.column_paths),
                            "table_header_line": table_semantics.header_line,
                            "table_row_lines": list(table_semantics.row_lines),
                            "table_header_row_count": len(table_semantics.header_rows),
                            "table_row_count": len(table_semantics.row_lines),
                            "table_column_count": len(table_semantics.column_paths),
                        },
                        table_cells=[list(row) for row in table_semantics.matrix],
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
    metadata: dict[str, object] | None = None,
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
        "metadata": metadata or {},
        "acl": _build_acl_metadata(acl_groups),
        "html": html,
        "table_cells": table_cells,
    }


def _build_unit_metadata(
    *,
    title: str,
    policy_doc_no: str | None,
    preface_text: str | None,
) -> dict[str, object]:
    metadata: dict[str, object] = {"title": title}
    if policy_doc_no:
        metadata["policy_doc_no"] = policy_doc_no
    if preface_text:
        metadata["preface_text"] = preface_text
    return metadata


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


def _looks_like_title_variant_suffix_line(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return bool(normalized and TITLE_VARIANT_SUFFIX_RE.fullmatch(normalized))


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


def _build_table_unit_semantics(
    *,
    table_cells: list[list[str]] | None,
    table_context: object,
) -> NormalizedHandbookTable | None:
    if not table_cells:
        return None
    normalized_matrix = [tuple(normalize_handbook_body_text(cell) for cell in row) for row in table_cells]
    caption_text = normalize_handbook_body_text(str(table_context)) if isinstance(table_context, str) else ""
    if _looks_like_form_table(normalized_matrix, caption_text=caption_text):
        return None
    header_row_count = _detect_table_header_row_count([list(row) for row in normalized_matrix])
    header_rows = tuple(normalized_matrix[:header_row_count])
    body_rows = tuple(normalized_matrix[header_row_count:])
    selected_columns = _select_semantic_table_columns(header_rows=header_rows, body_rows=body_rows)
    if not selected_columns:
        return None
    filtered_header_rows = tuple(
        tuple(row[column_index] for column_index in selected_columns)
        for row in header_rows
    )
    filtered_body_rows = tuple(
        tuple(row[column_index] for column_index in selected_columns)
        for row in body_rows
    )
    filtered_body_rows = _merge_split_table_group_labels(filtered_body_rows)
    column_paths = _build_table_column_paths(
        header_rows=filtered_header_rows or (tuple(filtered_body_rows[0]),),
        body_rows=filtered_body_rows,
    )
    header_line = " | ".join(column_paths)
    row_lines = tuple(" | ".join(row) for row in filtered_body_rows if any(cell.strip() for cell in row))
    if not row_lines:
        return None
    caption_lines = (caption_text,) if caption_text else ()
    return NormalizedHandbookTable(
        matrix=tuple((*filtered_header_rows, *filtered_body_rows)),
        header_rows=filtered_header_rows,
        body_rows=filtered_body_rows,
        column_paths=column_paths,
        header_line=header_line,
        row_lines=row_lines,
        caption_lines=caption_lines,
        note_lines=(),
    )


def _detect_table_header_row_count(table_matrix: list[list[str]]) -> int:
    if not table_matrix:
        return 0
    if len(table_matrix) == 1:
        return 1
    first_row = table_matrix[0]
    second_row = table_matrix[1]
    if _looks_like_header_continuation_row(first_row, second_row):
        return 2
    return 1


def _looks_like_header_continuation_row(first_row: list[str], second_row: list[str]) -> bool:
    first_non_empty = [cell.strip() for cell in first_row if cell.strip()]
    second_non_empty = [cell.strip() for cell in second_row if cell.strip()]
    if not first_non_empty or not second_non_empty:
        return False
    if _row_looks_like_numeric_payload(second_non_empty):
        return False
    first_form_prompt_count = sum(
        1
        for cell in first_non_empty
        if _contains_form_table_signature_keyword(cell) or _contains_decorative_table_keyword(cell)
    )
    second_field_like_count = sum(
        1
        for cell in second_non_empty
        if len(cell) <= 10 or _contains_form_table_keyword(cell)
    )
    if first_form_prompt_count >= 2 and second_field_like_count >= max(2, len(second_non_empty) - 1):
        return True
    first_has_duplicate_labels = len(set(first_non_empty)) < len(first_non_empty)
    second_short_label_count = sum(1 for cell in second_non_empty if len(cell) <= 8)
    return first_has_duplicate_labels and second_short_label_count == len(second_non_empty)


def _row_looks_like_numeric_payload(cells: list[str]) -> bool:
    numeric_like = 0
    for cell in cells:
        normalized = normalize_handbook_body_text(cell)
        if not normalized:
            continue
        if LIST_ENTRY_PHONE_RE.search(normalized) or re.search(r"\d", normalized):
            numeric_like += 1
    return numeric_like >= max(1, len(cells) // 2)


def _select_semantic_table_columns(
    *,
    header_rows: tuple[tuple[str, ...], ...],
    body_rows: tuple[tuple[str, ...], ...],
) -> tuple[int, ...]:
    width = max((len(row) for row in (*header_rows, *body_rows)), default=0)
    selected: list[int] = []
    for column_index in range(width):
        header_labels = tuple(
            row[column_index].strip()
            for row in header_rows
            if column_index < len(row) and row[column_index].strip()
        )
        column_values = tuple(
            row[column_index].strip()
            for row in body_rows
            if column_index < len(row) and row[column_index].strip()
        )
        if _is_semantic_table_column(header_labels=header_labels, column_values=column_values):
            selected.append(column_index)
    return tuple(selected)


def _is_semantic_table_column(
    *,
    header_labels: tuple[str, ...],
    column_values: tuple[str, ...],
) -> bool:
    header_text = " / ".join(header_labels)
    if _contains_decorative_table_keyword(header_text):
        return False
    if not column_values:
        return bool(header_labels)
    decorative_value_count = sum(1 for value in column_values if _looks_like_decorative_table_cell(value))
    if decorative_value_count >= max(1, len(column_values)):
        return False
    return True


def _build_table_column_paths(
    *,
    header_rows: tuple[tuple[str, ...], ...],
    body_rows: tuple[tuple[str, ...], ...],
) -> tuple[str, ...]:
    width = max((len(row) for row in header_rows), default=0)
    column_paths: list[str] = []
    for column_index in range(width):
        parts: list[str] = []
        for header_row in header_rows:
            if column_index >= len(header_row):
                continue
            label = normalize_handbook_body_text(header_row[column_index])
            if not label:
                continue
            if not parts or parts[-1] != label:
                parts.append(label)
        if parts:
            column_paths.append(" / ".join(parts))
            continue
        inferred = _infer_missing_table_column_label(column_index=column_index, body_rows=body_rows)
        column_paths.append(inferred if inferred else "未命名列")
    return tuple(column_paths)


def _merge_split_table_group_labels(body_rows: tuple[tuple[str, ...], ...]) -> tuple[tuple[str, ...], ...]:
    if len(body_rows) < 2:
        return body_rows
    repaired_rows = [list(row) for row in body_rows]
    for row_index in range(len(repaired_rows) - 1):
        current_label = normalize_handbook_body_text(repaired_rows[row_index][0])
        previous_label = normalize_handbook_body_text(repaired_rows[row_index - 1][0]) if row_index > 0 else ""
        next_label = normalize_handbook_body_text(repaired_rows[row_index + 1][0])
        if not _should_merge_split_table_group_label(
            current_row=repaired_rows[row_index],
            current_label=current_label,
            previous_label=previous_label,
            next_label=next_label,
            following_rows=repaired_rows[row_index + 1 :],
        ):
            continue
        repaired_rows[row_index][0] = f"{current_label}{next_label}"
    return tuple(tuple(row) for row in repaired_rows)


def _should_merge_split_table_group_label(
    *,
    current_row: list[str],
    current_label: str,
    previous_label: str,
    next_label: str,
    following_rows: list[list[str]],
) -> bool:
    if not current_label or not next_label or current_label == next_label:
        return False
    if previous_label == current_label:
        return False
    if not (2 <= len(current_label) <= 6 and 4 <= len(next_label) <= 12):
        return False
    if not re.fullmatch(r"[\u4e00-\u9fff()（）]+", current_label):
        return False
    if not re.fullmatch(r"[\u4e00-\u9fff()（）]+", next_label):
        return False
    if len(current_label + next_label) > 18:
        return False
    if any(cell.strip() for cell in current_row[2:]):
        return False
    repeated_group_rows = 0
    for row in following_rows:
        if normalize_handbook_body_text(row[0]) != next_label:
            break
        repeated_group_rows += 1
    return repeated_group_rows >= 2


def _infer_missing_table_column_label(
    *,
    column_index: int,
    body_rows: tuple[tuple[str, ...], ...],
) -> str | None:
    column_values = [
        normalize_handbook_body_text(row[column_index])
        for row in body_rows
        if column_index < len(row) and normalize_handbook_body_text(row[column_index])
    ]
    if not column_values:
        return None
    if column_index == 0 and _looks_like_project_table_column(column_values):
        return GENERIC_TABLE_PROJECT_LABEL
    return None


def _looks_like_form_table(
    table_matrix: list[tuple[str, ...]],
    *,
    caption_text: str,
) -> bool:
    total_cells = sum(len(row) for row in table_matrix)
    if total_cells == 0:
        return False
    flattened = [cell.strip() for row in table_matrix for cell in row]
    blank_count = sum(1 for cell in flattened if not cell)
    non_empty = [cell for cell in flattened if cell]
    if not non_empty:
        return False
    if any(keyword in caption_text for keyword in FORM_TABLE_CAPTION_KEYWORDS):
        return True
    decorative_hits = sum(1 for cell in non_empty if _looks_like_decorative_table_cell(cell))
    field_hits = sum(1 for cell in non_empty if _contains_form_table_keyword(cell))
    checkbox_hits = sum(1 for cell in non_empty if _contains_form_table_checkbox(cell))
    signature_hits = sum(1 for cell in non_empty if _contains_form_table_signature_keyword(cell))
    unique_non_empty_count = len(set(non_empty))
    section_row_hits = sum(
        1
        for row in table_matrix
        if row and row[0].strip() and _contains_form_table_section_keyword(row[0])
    )
    blank_ratio = blank_count / total_cells
    if checkbox_hits >= 2 and (field_hits >= 3 or signature_hits >= 1 or section_row_hits >= 2):
        return True
    if len(table_matrix) <= 3 and unique_non_empty_count <= 6 and signature_hits >= 2 and field_hits >= 2:
        return True
    if section_row_hits >= 3 and (signature_hits >= 1 or field_hits >= 4):
        return True
    return blank_ratio >= 0.2 and (decorative_hits >= 2 or field_hits >= 3)


def _contains_form_table_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in FORM_TABLE_FIELD_KEYWORDS)


def _contains_form_table_section_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in FORM_TABLE_SECTION_KEYWORDS)


def _contains_form_table_signature_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in FORM_TABLE_SIGNATURE_KEYWORDS)


def _contains_form_table_checkbox(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(marker in normalized for marker in FORM_TABLE_CHECKBOX_MARKERS)


def _contains_decorative_table_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in DECORATIVE_TABLE_KEYWORDS)


def _looks_like_decorative_table_cell(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if _contains_decorative_table_keyword(normalized):
        return True
    return normalized.startswith("(请在") and normalized.endswith(")")


def _looks_like_project_table_column(values: list[str]) -> bool:
    if not values:
        return False
    textual_values = sum(1 for value in values if not _looks_like_numeric_dominant_cell(value))
    return textual_values >= max(1, len(values) - 1)


def _looks_like_numeric_dominant_cell(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    return bool(re.fullmatch(r"[0-9０-９\s\-–—~～./:%()（）]+", normalized))


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
    raw_rest = " ".join(_normalize_body_fragment(match.group("rest")).split()).strip()
    rest = normalize_handbook_article_body_text(raw_rest)
    return _normalize_article_label(match.group("label")), rest

def _looks_like_policy_doc_no(text: str) -> bool:
    return bool(POLICY_DOC_NO_RE.match(_normalize_policy_doc_no(text)))


def _normalize_policy_doc_no(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    normalized = re.sub(r"\s*([\[〔])\s*", r"\1", normalized)
    normalized = re.sub(r"\s*([\]〕])\s*", r"\1", normalized)
    normalized = re.sub(r"(?<=[\]〕])\s+(?=\d)", "", normalized)
    return normalized

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


def _looks_like_appendix_heading(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    for marker in APPENDIX_MARKERS:
        if not normalized.startswith(marker):
            continue
        remainder = normalized[len(marker) :]
        if not remainder:
            return True
        leading = remainder[0]
        if leading.isspace() or leading in "0123456789一二三四五六七八九十:：":
            return True
    return False


def _extract_appendix_heading_title(text: str) -> str | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    for marker in APPENDIX_MARKERS:
        if not normalized.startswith(marker):
            continue
        remainder = normalized[len(marker) :].lstrip()
        if remainder.startswith((":", "：")):
            remainder = remainder[1:].lstrip()
        remainder = normalize_handbook_body_text(remainder)
        if remainder:
            return remainder
    return None


def _looks_like_appendix_marker_only(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return normalized in {"附件:", "附件：", "附表:", "附表：", "附录:", "附录："}


def _split_appendix_inline_title(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    for suffix in APPENDIX_INLINE_TITLE_SUFFIXES:
        marker = f"{suffix}兹证明"
        marker_index = normalized.find(marker)
        if marker_index <= 0:
            continue
        title = normalized[: marker_index + len(suffix)].strip()
        body = normalized[marker_index + len(suffix) :].lstrip()
        if not title or not body:
            continue
        return title, body
    split_body = _split_title_like_heading_body(normalized)
    if split_body is None:
        return None
    heading, remainder = split_body
    if not any(heading.endswith(suffix) for suffix in APPENDIX_INLINE_TITLE_SUFFIXES):
        return None
    return heading, remainder


def _looks_like_table_lead_label(text: str, *, next_row: dict[str, object] | None) -> bool:
    if next_row is None or str(next_row.get("row_type") or "") != "table":
        return False
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if re.search(r"[。；;！？!?]", normalized):
        return False
    if len(normalized) > 32:
        return False
    return INLINE_LIST_MARKER_RE.match(normalized) is not None


def _should_attach_policy_page_to_following_table(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if "\n" in normalized:
        return False
    if LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    return len(normalized) <= 48


def _should_merge_policy_fragment_into_previous_line(
    *,
    fragment: str,
    current_parts: list[str],
    next_row: dict[str, object] | None,
) -> bool:
    normalized_fragment = normalize_handbook_body_text(fragment)
    if not normalized_fragment or not current_parts or next_row is None:
        return False
    if str(next_row.get("row_type") or "") != "table":
        return False
    previous_line = normalize_handbook_body_text(current_parts[-1])
    if INLINE_LIST_MARKER_RE.match(previous_line) is None:
        return False
    if _split_article_line(normalized_fragment)[0] is not None:
        return False
    if _looks_like_appendix_heading(normalized_fragment):
        return False
    if _looks_like_appendix_marker_only(normalized_fragment):
        return False
    if classify_structural_heading(text=normalized_fragment, row_type="paragraph", next_text=None) is not None:
        return False
    if _looks_like_list_entry(normalized_fragment):
        return False
    if re.search(r"[。；;！？!?]", normalized_fragment):
        return False
    return len(normalized_fragment) <= 32


def _merge_policy_fragment_into_previous_line(previous_line: str, fragment: str) -> str:
    normalized_previous = normalize_handbook_body_text(previous_line)
    normalized_fragment = normalize_handbook_body_text(fragment)
    return f"{normalized_previous}{normalized_fragment}".strip()


def _looks_like_list_section_heading(text: str, next_text: str | None) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or next_text is None:
        return False
    if _split_article_line(normalized)[0] is not None:
        return False
    if classify_structural_heading(text=normalized, row_type="paragraph", next_text=next_text) is not None:
        return False
    if LIST_ENTRY_PHONE_RE.search(normalized):
        return False
    if any(char.isspace() for char in normalized):
        return False
    if len(normalized) > 24:
        return False
    if LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    return _looks_like_list_entry(next_text)


def _looks_like_navigation_policy_leaf(
    text: str,
    *,
    current_section_nodes: list[tuple[int, str]],
) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    match = INLINE_LIST_MARKER_RE.match(normalized)
    if match is None:
        return False
    body = match.group("body").strip()
    if not body or len(body) > 24:
        return False
    if any(keyword in body for keyword in NAVIGATION_LEAF_FORBIDDEN_FRAGMENTS):
        return False
    return any(keyword in section_text for _, section_text in current_section_nodes for keyword in NAVIGATION_SECTION_KEYWORDS)


def _looks_like_attachment_title_text(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    candidate = normalized[1:-1].strip() if normalized.startswith("《") and normalized.endswith("》") else normalized
    if not candidate or len(candidate) > 48:
        return False
    return any(candidate.endswith(suffix) for suffix in ATTACHMENT_TITLE_SUFFIXES)


def _looks_like_ancillary_note_line(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    return len(normalized) <= 24 and any(normalized.endswith(suffix) for suffix in ANCILLARY_NOTE_SUFFIXES)


def _looks_like_appendix_leaf_section_heading(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or re.search(r"[，,。；;！？!?]", normalized):
        return False
    return bool(re.fullmatch(r"[0-9一二三四五六七八九十百千万〇零两]+[:：]?", normalized))


def _looks_like_form_template_legend(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or len(normalized) > 96:
        return False
    if "为:" not in normalized and "为：" not in normalized:
        return False
    if not re.search(r"[;；、]", normalized):
        return False
    field_hits = sum(1 for keyword in FORM_TABLE_FIELD_KEYWORDS if keyword in normalized)
    return field_hits >= 2


def _next_policy_leaf_section_rank(current_section_nodes: list[tuple[int, str]]) -> int:
    if not current_section_nodes:
        return POLICY_LEAF_SECTION_RANK
    return max(rank for rank, _ in current_section_nodes) + 1


def _normalize_attachment_heading_text(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    if normalized.startswith("《") and normalized.endswith("》"):
        inner = normalized[1:-1].strip()
        if inner:
            return inner
    return normalized


def _next_content_text(rows: list[dict[str, object]], start_index: int) -> str | None:
    for row in rows[start_index:]:
        if str(row.get("row_type") or "") == "table":
            continue
        text = _row_text(row)
        if text:
            return text
    return None


def _next_nonblank_row(rows: list[dict[str, object]], start_index: int) -> dict[str, object] | None:
    for row in rows[start_index:]:
        row_type = str(row.get("row_type") or "")
        if row_type == "table":
            return row
        if _row_text(row):
            return row
    return None


def _has_following_table_before_content_break(rows: list[dict[str, object]], start_index: int) -> bool:
    for row in rows[start_index:]:
        row_type = str(row.get("row_type") or "")
        if row_type == "table":
            return True
        text = _row_text(row)
        if not text:
            continue
        if row_type == "heading":
            continue
        return False
    return False


def _looks_like_table_context(
    text: str,
    *,
    next_row: dict[str, object] | None = None,
    followed_by_table: bool | None = None,
) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if followed_by_table is None:
        followed_by_table = next_row is not None and str(next_row.get("row_type") or "") == "table"
    if normalized.endswith(("：", ":")):
        return True
    if followed_by_table and any(phrase in normalized for phrase in TABLE_CONTEXT_INTRO_PHRASES):
        return True
    return bool(
        next_row is not None
        and str(next_row.get("row_type") or "") == "table"
        and re.match(r"^[（(][一二三四五六七八九十0-9]+[)）]", normalized)
    )


def _split_inline_enumerated_provision(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    if _split_article_line(normalized)[0] is not None:
        return None
    match = INLINE_ENUMERATED_LABEL_RE.match(normalized)
    if match is None or not INLINE_ENUMERATED_PROVISION_RE.match(normalized):
        return None
    return match.group("label"), normalized


def _looks_like_terminal_inline_enumerated_provision(
    text: str,
    current_section_nodes: list[tuple[int, str]],
) -> bool:
    provision = _split_inline_enumerated_provision(text)
    if provision is None:
        return False
    _, normalized = provision
    body = normalized.split("、", 1)[1].strip()
    if not body:
        return False
    in_closing_section = any(keyword in section_text for _, section_text in current_section_nodes for keyword in CLOSING_SECTION_KEYWORDS)
    if in_closing_section and len(body) <= 64:
        return True
    return len(body) <= 96 and (
        any(keyword in body for keyword in TERMINAL_PROVISION_KEYWORDS) or DATED_EFFECTIVE_CLAUSE_RE.match(body) is not None
    )


def _should_emit_inline_policy_provision(
    text: str,
    *,
    current_section_nodes: list[tuple[int, str]],
    current_policy_page: dict[str, object] | None,
) -> bool:
    if _looks_like_terminal_inline_enumerated_provision(text, current_section_nodes):
        return True
    if current_policy_page is None:
        return False
    provision = _split_inline_enumerated_provision(text)
    if provision is None:
        return False
    _, normalized = provision
    body = normalized.split("、", 1)[1].strip()
    if len(body) > 128:
        return False
    return _policy_page_contains_nested_numbered_items(current_policy_page)


def _policy_page_contains_nested_numbered_items(current_policy_page: dict[str, object]) -> bool:
    parts = current_policy_page.get("parts")
    if not isinstance(parts, list):
        return False
    for part in parts:
        normalized = normalize_handbook_body_text(str(part))
        if re.match(r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])", normalized):
            return True
    return False


def _looks_like_inline_enumerated_heading(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if normalized[-1] in "。；！？":
        return False
    return bool(INLINE_ENUMERATED_HEADING_RE.match(normalized))


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
