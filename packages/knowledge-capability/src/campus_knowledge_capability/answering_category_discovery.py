from __future__ import annotations

from campus_contracts import EvidenceSource

from .answer_selection_statements import _is_generic_intro_statement
from .answer_shared import _normalize_snippet
from .answer_text_cleanup import finalize_answer_text


def _compose_category_discovery_list_answer(
    *,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    category_display_name: str = "",
    audience: str = "",
) -> str:
    items: list[str] = []
    seen_titles: set[str] = set()
    for source, statements in selected_rows:
        title = source.source_title.strip() or source.doc_id.split(":", 1)[-1].strip()
        if not title or title in seen_titles:
            continue
        seen_titles.add(title)
        statement = next(
            (
                item
                for item in statements
                if item.strip() and _is_category_list_description_statement(item)
            ),
            "",
        )
        if statement:
            items.append(f"{len(items) + 1}. 《{title}》：{statement}")
        else:
            items.append(f"{len(items) + 1}. 《{title}》")
    if not items:
        return ""
    category = _normalize_snippet(category_display_name) or "相关"
    audience_prefix = f"{_normalize_snippet(audience)}" if audience else ""
    return finalize_answer_text(
        f"当前已收录依据中，{audience_prefix}{category}相关制度包括："
        + "；".join(items)
        + "。是否可申请、申请时间和名额以当年通知/学院细则为准。"
    )


def _is_category_list_description_statement(statement: str) -> bool:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return False
    if _is_generic_intro_statement(normalized):
        return False
    if normalized.startswith("标题：") or " | 章节：" in normalized or " | 条款：" in normalized:
        return False
    if "->" in normalized or "→" in normalized:
        return False
    if any(cue in normalized for cue in ("流程", "步骤", "程序", "审核", "审定", "推荐")):
        return False
    if any(cue in normalized for cue in ("不得", "不得同时", "不能", "不予", "取消")):
        return False
    if "同时申请" in normalized:
        return False
    return not any(cue in normalized for cue in ("评定比例", "推荐比例", "名额", "特殊培养类型"))
