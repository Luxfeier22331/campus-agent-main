from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

from campus_ingestion_core.official_web_projection_shared import _normalize_string_list

SEMANTIC_HASH_TERMINAL_COPYRIGHT_PATTERN = re.compile(r"^copyright(?:@|\b)")
_OFFICIAL_WEB_NOTICE_TITLE_HINTS = ("讲座", "预告", "通知", "公告", "活动")
_OFFICIAL_WEB_REFERENCE_PAGE_TITLES = frozenset(
    {
        "学校简介",
        "学校概况",
        "本科培养",
        "研究生培养",
        "博士后",
        "访问学者",
        "现任领导",
        "学术名流",
        "校友会简介",
        "基金会简介",
    }
)
_OFFICIAL_WEB_SOURCE_ATTRIBUTION_PATTERN = re.compile(r"^[（(]?\s*来源[:：]\s*[^（）()]+[)）]?$")
_OFFICIAL_WEB_LABELED_FACT_LINE_PATTERN = re.compile(r"^(?P<label>[^：:\n]{1,16})[:：]\s*\S.+$")
_OFFICIAL_WEB_MEDIA_CAPTION_PATTERN = re.compile(r"^[\u4e00-\u9fffA-Za-z·]{1,24}\s*摄$")
_OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES = frozenset(
    {"source_attribution", "boilerplate", "media_caption"}
)
_OFFICIAL_WEB_NOTICE_FACT_LABELS = frozenset(
    {
        "讲座主题",
        "活动主题",
        "主题",
        "主讲人",
        "主 讲 人",
        "讲座时间",
        "活动时间",
        "时间",
        "讲座地点",
        "活动地点",
        "地点",
        "线上腾讯会议",
        "腾讯会议",
        "会议号",
    }
)
SEMANTIC_HASH_TERMINAL_BOILERPLATE_PREFIXES = (
    "新闻网版权与免责声明",
    "投稿方式：",
    "投稿方式:",
    "① 凡本网未注明其他出处的作品",
    "② 凡本网注明其他来源的作品",
    "③ 有关作品内容、版权和其它问题请与我们联系",
)


@dataclass(frozen=True, slots=True)
class _ArticleLineSemantics:
    line_class: Literal[
        "narrative_paragraph",
        "labeled_fact_line",
        "source_attribution_line",
        "terminal_boilerplate_line",
        "media_caption_line",
    ]
    content_role: str


def _looks_like_low_value_public_notice_page(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    normalized_canonical_url: str,
) -> bool:
    if page_family != "article_detail" or document_kind != "article":
        return False
    normalized_title = " ".join(title.split()).strip()
    normalized_url = normalized_canonical_url.lower().strip()
    if not normalized_title and not normalized_url:
        return False
    procurement_hit = any(
        token in normalized_title
        for token in ("采购", "招标", "比选", "询价", "竞价", "成交", "中标", "谈判结果")
    )
    recruitment_hit = "招聘" in normalized_title
    public_notice_hit = any(token in normalized_title for token in ("公告", "公示", "公示信息"))
    if procurement_hit and (public_notice_hit or "结果" in normalized_title):
        return True
    if recruitment_hit and public_notice_hit:
        return True
    return "招聘" in normalized_url and any(
        token in normalized_url for token in ("gonggao", "公告", "公示")
    )


def _resolve_document_serving_intent(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    normalized_canonical_url: str,
) -> str:
    if page_family == "listing_page" or document_kind == "listing":
        return "audit_only"
    if _looks_like_low_value_public_notice_page(
        page_family=page_family,
        document_kind=document_kind,
        title=title,
        normalized_canonical_url=normalized_canonical_url,
    ):
        return "audit_only"
    return "promotable"


def _resolve_document_promotion_block_reason(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    normalized_canonical_url: str,
) -> str | None:
    if page_family == "listing_page" or document_kind == "listing":
        return "listing_page_audit_only"
    if _looks_like_low_value_public_notice_page(
        page_family=page_family,
        document_kind=document_kind,
        title=title,
        normalized_canonical_url=normalized_canonical_url,
    ):
        return "low_value_public_notice_audit_only"
    return None


def _resolve_projection_content_role(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    line_class: str = "narrative_paragraph",
) -> str:
    if page_family == "listing_page" or document_kind == "listing":
        return "navigation_audit"
    if document_kind == "directory":
        return "directory_reference"
    if line_class == "source_attribution_line":
        return "source_attribution"
    if line_class == "terminal_boilerplate_line":
        return "boilerplate"
    if line_class == "media_caption_line":
        return "media_caption"
    if _is_reference_like_article_title(title):
        return "reference_fact"
    if _is_notice_like_article_title(title) and line_class == "labeled_fact_line":
        return "notice_fact"
    return "primary_content"


def _resolve_projection_is_answer_bearing(content_role: str | None) -> bool:
    normalized_role = str(content_role or "").strip()
    return (
        normalized_role not in _OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES
        and normalized_role != "navigation_audit"
    )


def _build_semantic_content_hash(
    *,
    document_kind: str,
    title: str,
    units: list[dict[str, object]],
) -> str:
    normalized_lines: list[str] = [f"title:{' '.join(title.split()).strip()}"]
    for unit in units:
        metadata = unit.get("metadata") if isinstance(unit.get("metadata"), dict) else {}
        content_role = str(metadata.get("content_role") or "").strip()
        if content_role in _OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES:
            continue
        text = _normalize_semantic_hash_text(str(unit.get("clean_text") or ""))
        if not text:
            continue
        unit_type = str(unit.get("unit_type") or "").strip()
        anchor = unit.get("anchor") if isinstance(unit.get("anchor"), dict) else {}
        section_path = " / ".join(
            item.strip()
            for item in _normalize_string_list(
                anchor.get("section_path") if isinstance(anchor, dict) else []
            )
            if item.strip()
        )
        normalized_lines.append(
            "\t".join(
                [
                    document_kind,
                    unit_type,
                    section_path,
                    " ".join(text.split()).strip(),
                ]
            )
        )
    digest = hashlib.sha256("\n".join(normalized_lines).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _normalize_semantic_hash_text(text: str) -> str:
    normalized_lines = [" ".join(line.split()).strip() for line in text.splitlines()]
    normalized_lines = [line for line in normalized_lines if line]
    while normalized_lines and _is_semantic_hash_terminal_boilerplate_line(normalized_lines[-1]):
        normalized_lines.pop()
    return "\n".join(normalized_lines).strip()


def _is_support_only_projection_unit(unit: dict[str, object]) -> bool:
    metadata = unit.get("metadata")
    if not isinstance(metadata, dict):
        return False
    return (
        str(metadata.get("content_role") or "").strip() in _OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES
    )


def _classify_article_line(*, title: str, document_kind: str, text: str) -> _ArticleLineSemantics:
    if document_kind != "article":
        return _ArticleLineSemantics(
            line_class="narrative_paragraph",
            content_role="primary_content",
        )
    normalized = " ".join(text.split()).strip()
    if _is_semantic_hash_terminal_boilerplate_line(normalized):
        return _ArticleLineSemantics(
            line_class="terminal_boilerplate_line",
            content_role=_resolve_projection_content_role(
                page_family="article_detail",
                document_kind=document_kind,
                title=title,
                line_class="terminal_boilerplate_line",
            ),
        )
    if _looks_like_source_attribution_line(normalized):
        return _ArticleLineSemantics(
            line_class="source_attribution_line",
            content_role=_resolve_projection_content_role(
                page_family="article_detail",
                document_kind=document_kind,
                title=title,
                line_class="source_attribution_line",
            ),
        )
    if _looks_like_media_caption_line(normalized):
        return _ArticleLineSemantics(
            line_class="media_caption_line",
            content_role=_resolve_projection_content_role(
                page_family="article_detail",
                document_kind=document_kind,
                title=title,
                line_class="media_caption_line",
            ),
        )
    line_class = "narrative_paragraph"
    if _looks_like_labeled_fact_line(normalized):
        if not _is_notice_like_article_title(title) or _looks_like_notice_fact_line(normalized):
            line_class = "labeled_fact_line"
    return _ArticleLineSemantics(
        line_class=line_class,
        content_role=_resolve_projection_content_role(
            page_family="article_detail",
            document_kind=document_kind,
            title=title,
            line_class=line_class,
        ),
    )


def _is_notice_like_article_title(title: str) -> bool:
    normalized = " ".join(title.split()).strip()
    return any(token in normalized for token in _OFFICIAL_WEB_NOTICE_TITLE_HINTS)


def _is_reference_like_article_title(title: str) -> bool:
    normalized = " ".join(title.split()).strip()
    if normalized in _OFFICIAL_WEB_REFERENCE_PAGE_TITLES:
        return True
    return any(token in normalized for token in ("简介", "概况"))


def _looks_like_source_attribution_line(text: str) -> bool:
    return _OFFICIAL_WEB_SOURCE_ATTRIBUTION_PATTERN.match(text) is not None


def _looks_like_labeled_fact_line(text: str) -> bool:
    return _OFFICIAL_WEB_LABELED_FACT_LINE_PATTERN.match(text) is not None


def _looks_like_notice_fact_line(text: str) -> bool:
    match = _OFFICIAL_WEB_LABELED_FACT_LINE_PATTERN.match(text)
    if match is None:
        return False
    return str(match.group("label") or "").strip() in _OFFICIAL_WEB_NOTICE_FACT_LABELS


def _looks_like_media_caption_line(text: str) -> bool:
    return _OFFICIAL_WEB_MEDIA_CAPTION_PATTERN.match(text) is not None


def _is_semantic_hash_terminal_boilerplate_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if normalized.startswith(SEMANTIC_HASH_TERMINAL_BOILERPLATE_PREFIXES):
        return True
    lowered = normalized.casefold()
    if "版权与免责声明" in normalized:
        return True
    if "all rights reserved" in lowered:
        return True
    if "转载、摘编或以其它方式使用本网作品" in normalized:
        return True
    if "并不代表本网赞同其观点和对其真实性负责" in normalized:
        return True
    if SEMANTIC_HASH_TERMINAL_COPYRIGHT_PATTERN.match(lowered) is not None:
        return True
    return False
