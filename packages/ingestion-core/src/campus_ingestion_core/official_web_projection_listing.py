from __future__ import annotations

import re

from campus_ingestion_core.official_web_projection_shared import _normalize_block_text

LISTING_DATE_ONLY_PATTERN = re.compile(r"^20\d{2}([./-])\d{1,2}\1\d{1,2}$")
LISTING_COMPACTED_ISO_DATE_PREFIX_PATTERN = re.compile(r"^(20\d{2})[-./](\d{2})[-./](\d{2})(\S.+)$")
LISTING_COMPACTED_DAY_YEAR_MONTH_PREFIX_PATTERN = re.compile(
    r"^(\d{2})(20\d{2})[./-](\d{2})(\S.+)$"
)
LISTING_UPPERCASE_BADGE_PATTERN = re.compile(r"^[A-Z][A-Z&/ \-]{2,}$")
LISTING_HEADING_BADGE_SUFFIX_PATTERN = re.compile(r"^(?P<label>.+?)(?P<badge>[A-Z][A-Z&/ \-]{2,})$")
OFFICIAL_WEB_LOW_VALUE_QR_SIGNUP_PATTERN = re.compile(
    r"^(?:请[^。；]*?)?(?:扫描|扫码)(?:下方|下列)?(?:二维码|二维码报名码)[^。；]*(?:预约|报名|参与|讲座信息)",
)
OFFICIAL_WEB_LOW_VALUE_ACTIVITY_POINTS_PATTERN = re.compile(
    r"^[（(]?(?:活动结束后|参与活动后)[^。；]*(?:积分|学时|参与者)[^。；]*[)）]?$"
)
LISTING_PAGINATION_TOKENS = frozenset({"首页", "末页", "尾页", "上页", "下页", "上一页", "下一页"})
LISTING_UTILITY_LINK_TOKENS = frozenset(
    {
        "信息门户",
        "领导信箱",
        "精品课程",
        "民大校报",
        "信息公开",
        "会议室预约",
        "公共服务",
        "图书馆",
    }
)
ListingBufferEntry = tuple[int, str]


def _normalize_listing_context_label(text: str) -> str:
    return " ".join(text.split()).strip()


def _sanitize_listing_parent_heading_path(
    parent_heading_path: list[str],
    listing_item_headings: set[str],
) -> list[str]:
    if not parent_heading_path or not listing_item_headings:
        return list(parent_heading_path)
    return [
        item
        for item in parent_heading_path
        if _normalize_listing_context_label(item) not in listing_item_headings
    ]


def _resolve_listing_section_path(
    *,
    parent_heading_path: list[str],
    current_section_path: list[str],
    listing_item_headings: set[str],
) -> list[str]:
    sanitized_parent_heading_path = _sanitize_listing_parent_heading_path(
        parent_heading_path,
        listing_item_headings,
    )
    if sanitized_parent_heading_path:
        return sanitized_parent_heading_path
    return list(current_section_path)


def _looks_like_listing_item_heading_block(
    main_blocks: list[dict[str, object]],
    block_index: int,
    text: str,
) -> bool:
    normalized_text = _normalize_listing_context_label(text)
    if len(normalized_text) <= 12:
        return False
    for next_index in range(block_index + 1, min(len(main_blocks), block_index + 4)):
        next_block = main_blocks[next_index]
        next_role = str(next_block.get("blockRole") or "").strip()
        next_text = _normalize_listing_context_label(_normalize_block_text(next_block))
        if not next_text or next_role == "title":
            continue
        return next_role in {"heading", "link"} and next_text == normalized_text
    return False


def _finalize_listing_buffer_entries(
    lines: list[str],
    block_roles: list[str],
    navigation_flags: list[bool],
    boilerplate_flags: list[bool],
    section_path: list[str],
) -> list[ListingBufferEntry]:
    section_heading = section_path[-1] if section_path else ""
    normalized_input_lines = [_normalize_listing_line(line) for line in lines]
    short_label_token_count = sum(
        1 for line in normalized_input_lines if _looks_like_short_label_token(line)
    )
    deduped_entries: list[ListingBufferEntry] = []
    seen_non_date_lines: set[str] = set()
    seen_listing_title_lines: set[str] = set()
    seen_listing_date_lines: set[str] = set()
    for index, line in enumerate(lines):
        block_role = block_roles[index] if index < len(block_roles) else ""
        normalized = _normalize_listing_line(line)
        if not normalized or _should_skip_listing_line(normalized, section_heading):
            continue
        if (
            short_label_token_count >= 2
            and _looks_like_short_label_token(normalized)
            and (
                _is_listing_short_label_noise_candidate(
                    block_role,
                    navigation_flags[index] if index < len(navigation_flags) else False,
                    boilerplate_flags[index] if index < len(boilerplate_flags) else False,
                )
                or _is_interstitial_short_label_line(index, normalized_input_lines)
                or _is_trailing_short_label_cluster_line(index, normalized_input_lines)
            )
        ):
            continue
        if _should_drop_listing_summary_line(normalized, block_role):
            continue
        if _is_listing_date_only_line(normalized):
            seen_listing_date_lines.add(normalized)
            deduped_entries.append((index, normalized))
            continue
        title_date_pair = _split_listing_title_date_pair(normalized)
        if title_date_pair is not None:
            title_text, date_text = title_date_pair
            if title_text in seen_listing_title_lines and date_text in seen_listing_date_lines:
                continue
        if normalized in seen_non_date_lines:
            continue
        seen_non_date_lines.add(normalized)
        seen_listing_title_lines.add(
            title_date_pair[0] if title_date_pair is not None else normalized
        )
        if title_date_pair is not None:
            seen_listing_date_lines.add(title_date_pair[1])
        deduped_entries.append((index, normalized))
    return _drop_listing_teaser_cluster_entries(_drop_listing_aggregate_entries(deduped_entries))


def _normalize_listing_line(text: str) -> str:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return ""
    normalized = _split_compacted_listing_date_prefix(normalized)
    return " ".join(normalized.split()).strip()


def _split_compacted_listing_date_prefix(text: str) -> str:
    compacted_iso_match = LISTING_COMPACTED_ISO_DATE_PREFIX_PATTERN.match(text)
    if compacted_iso_match is not None:
        year, month, day, remainder = compacted_iso_match.groups()
        return f"{year}-{month.zfill(2)}-{day.zfill(2)} {remainder}".strip()

    compacted_day_year_month_match = LISTING_COMPACTED_DAY_YEAR_MONTH_PREFIX_PATTERN.match(text)
    if compacted_day_year_month_match is not None:
        day, year, month, remainder = compacted_day_year_month_match.groups()
        return f"{year}.{month.zfill(2)}.{day.zfill(2)} {remainder}".strip()

    return text


def _should_skip_listing_line(text: str, section_heading: str) -> bool:
    if text in {"更多", "当前位置：", "当前位置:"}:
        return True
    if text in LISTING_UTILITY_LINK_TOKENS:
        return True
    if _is_listing_pagination_token(text):
        return True
    if _looks_like_short_label_cluster(text):
        return True
    if _contains_terminal_ellipsis(text):
        return True
    if LISTING_UPPERCASE_BADGE_PATTERN.fullmatch(text) and text.upper() in section_heading.upper():
        return True
    return False


def _is_listing_pagination_token(text: str) -> bool:
    if text in LISTING_PAGINATION_TOKENS:
        return True
    return text.isdigit() and int(text) <= 99


def _should_drop_listing_summary_line(text: str, block_role: str) -> bool:
    if block_role != "paragraph":
        return False
    if _looks_like_short_label_cluster(text):
        return True
    if _contains_terminal_ellipsis(text):
        return True
    if _is_listing_date_only_line(text) or _split_listing_title_date_pair(text) is not None:
        return False
    punctuation_count = sum(
        text.count(punctuation) for punctuation in {"。", "！", "？", "；", "：", ":", "，", ","}
    )
    return len(text) >= 40 and punctuation_count >= 2


def _drop_listing_aggregate_entries(entries: list[ListingBufferEntry]) -> list[ListingBufferEntry]:
    filtered_entries: list[ListingBufferEntry] = []
    lines = [line for _, line in entries]
    for index, entry in enumerate(entries):
        line = entry[1]
        matching_shorter_lines = {
            other
            for other_index, other in enumerate(lines)
            if other_index != index and len(other) >= 4 and len(other) < len(line) and other in line
        }
        if len(matching_shorter_lines) >= 3 and line.count(" ") >= 2:
            continue
        filtered_entries.append(entry)
    return filtered_entries


def _drop_listing_teaser_cluster_entries(
    entries: list[ListingBufferEntry],
) -> list[ListingBufferEntry]:
    if len(entries) < 3:
        return entries
    lines = [line for _, line in entries]
    for start_index in range(1, len(entries)):
        trailing_lines = lines[start_index:]
        if len(trailing_lines) < 2:
            continue
        if not _looks_like_listing_series_anchor(lines[start_index - 1]):
            continue
        teaser_like_count = sum(
            1 for line in trailing_lines if _looks_like_listing_teaser_line(line)
        )
        if teaser_like_count >= 2:
            return entries[:start_index]
    return entries


def _is_listing_date_only_line(text: str) -> bool:
    return LISTING_DATE_ONLY_PATTERN.fullmatch(text) is not None


def _can_attach_listing_date(text: str) -> bool:
    return (
        not _is_listing_date_only_line(text)
        and not _listing_line_starts_with_date(text)
        and not any(
            punctuation in text for punctuation in {"。", "！", "？", "；", "：", ":", "!", "?"}
        )
        and len(text) <= 96
    )


def _listing_line_starts_with_date(text: str) -> bool:
    return (
        LISTING_DATE_ONLY_PATTERN.match(text) is not None
        or bool(re.match(r"^20\d{2}[./-]\d{2}[./-]\d{2}(?:\s|$)", text))
        or bool(re.match(r"^20\d{2}\.\d{2}\.\d{2}(?:\s|$)", text))
    )


def _split_listing_title_date_pair(text: str) -> tuple[str, str] | None:
    suffix_match = re.match(r"^(.+?)\s+(20\d{2}[./-]\d{2}[./-]\d{2})$", text)
    if suffix_match is not None:
        title_text, date_text = suffix_match.groups()
        return title_text.strip(), date_text
    prefix_match = re.match(r"^(20\d{2}[./-]\d{2}[./-]\d{2})\s+(.+)$", text)
    if prefix_match is not None:
        date_text, title_text = prefix_match.groups()
        return title_text.strip(), date_text
    return None


def _normalize_listing_section_heading(text: str) -> str:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return ""
    badge_match = LISTING_HEADING_BADGE_SUFFIX_PATTERN.fullmatch(normalized)
    if badge_match is None:
        return normalized
    label = badge_match.group("label").strip(" -/&")
    if label and _contains_cjk_character(label):
        return label
    return normalized


def _contains_cjk_character(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def _contains_terminal_ellipsis(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    return normalized.endswith("...") or normalized.endswith("…")


def _looks_like_listing_series_anchor(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    return bool(re.match(r"^【[^】]{1,20}】", normalized))


def _looks_like_listing_teaser_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if re.match(r"^\d+\s*张[，,、 ]?", normalized):
        return True
    if " | " in normalized:
        return True
    return False


def _looks_like_short_label_cluster(text: str) -> bool:
    tokens = [token.strip() for token in re.split(r"\s+", text) if token.strip()]
    if len(tokens) < 2:
        return False
    return all(_looks_like_short_label_token(token) for token in tokens)


def _is_listing_short_label_noise_candidate(
    block_role: str,
    is_navigation: bool,
    is_boilerplate: bool,
) -> bool:
    return block_role == "paragraph" or is_navigation or is_boilerplate


def _is_interstitial_short_label_line(index: int, normalized_lines: list[str]) -> bool:
    has_substantive_before = any(
        _is_substantive_listing_line(line) for line in normalized_lines[:index]
    )
    has_substantive_after = any(
        _is_substantive_listing_line(line) for line in normalized_lines[index + 1 :]
    )
    return has_substantive_before and has_substantive_after


def _is_substantive_listing_line(text: str) -> bool:
    return (
        bool(text)
        and not _looks_like_short_label_token(text)
        and not _is_listing_date_only_line(text)
    )


def _is_trailing_short_label_cluster_line(index: int, normalized_lines: list[str]) -> bool:
    trailing_start = len(normalized_lines)
    for candidate_index in range(len(normalized_lines) - 1, -1, -1):
        if _looks_like_short_label_token(normalized_lines[candidate_index]):
            trailing_start = candidate_index
            continue
        break
    trailing_lines = normalized_lines[trailing_start:]
    if len(trailing_lines) < 3:
        return False
    if not all(_looks_like_short_label_token(line) for line in trailing_lines):
        return False
    if index < trailing_start:
        return False
    return any(_is_substantive_listing_line(line) for line in normalized_lines[:trailing_start])


def _looks_like_short_label_token(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if len(normalized) > 6:
        return False
    if not _contains_cjk_character(normalized):
        return False
    if _is_listing_date_only_line(normalized):
        return False
    if any(
        punctuation in normalized for punctuation in {"。", "！", "？", "；", "：", ":", "，", ","}
    ):
        return False
    if any(character.isdigit() for character in normalized):
        return False
    return True


def _looks_like_headline_only_fragment(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if len(normalized) > 96:
        return False
    if _is_listing_date_only_line(normalized):
        return False
    if any(punctuation in normalized for punctuation in {"。", "！", "？", "；", ";"}):
        return False
    comma_count = normalized.count("，") + normalized.count(",")
    if comma_count >= 2:
        return False
    return True


def _looks_like_portal_generic_page(*, title: str, main_blocks: list[dict[str, object]]) -> bool:
    if not re.search(r"(新闻网|新闻中心|首页)", title):
        return False
    heading_count = 0
    link_count = 0
    paragraph_count = 0
    for block in main_blocks:
        block_role = str(block.get("blockRole") or "").strip()
        if block_role == "heading":
            heading_count += 1
        elif block_role == "link":
            link_count += 1
        elif block_role == "paragraph":
            paragraph_count += 1
    return heading_count >= 3 and link_count >= 2 and paragraph_count >= 2


def _looks_like_sparse_generic_link_hub(main_blocks: list[dict[str, object]]) -> bool:
    link_like_count = 0
    paragraph_count = 0
    for block in main_blocks:
        block_role = str(block.get("blockRole") or "").strip()
        if block_role in {"link", "list_item"}:
            link_like_count += 1
        elif block_role == "paragraph":
            paragraph_count += 1
    return paragraph_count == 0 and link_like_count >= 2


def _looks_like_portal_directory_page(
    *,
    title: str,
    manifest: dict[str, object],
    main_blocks: list[dict[str, object]],
) -> bool:
    normalized_title = " ".join(title.split()).strip()
    normalized_url = str(manifest.get("normalizedCanonicalUrl") or "").strip().rstrip("/")
    if normalized_title not in {"首页", "中央民族大学"} and not normalized_url.endswith(
        "://www.example.edu"
    ):
        if not normalized_url.endswith("://www.muc.edu.cn") and normalized_title != "门户首页":
            return False
    heading_count = 0
    link_like_count = 0
    date_like_count = 0
    short_utility_link_count = 0
    for block in main_blocks:
        block_role = str(block.get("blockRole") or "").strip()
        text = _normalize_block_text(block)
        if not text:
            continue
        if block_role == "heading":
            heading_count += 1
            if _looks_like_headline_only_fragment(text):
                link_like_count += 1
        elif block_role in {"link", "list_item"}:
            link_like_count += 1
            if text in LISTING_UTILITY_LINK_TOKENS or _looks_like_short_label_token(text):
                short_utility_link_count += 1
        elif block_role == "paragraph" and _looks_like_date_or_listing_badge_line(text):
            date_like_count += 1
    return heading_count >= 2 and (
        link_like_count >= 2 or date_like_count >= 2 or short_utility_link_count >= 1
    )


def _looks_like_date_or_listing_badge_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if _is_listing_date_only_line(normalized):
        return True
    return bool(re.fullmatch(r"20\d{2}[./-]\d{1,2}[./-]\d{1,2}", normalized))


def _should_skip_generic_noise_line(
    *,
    text: str,
    block_role: str,
    seen_primary_narrative: bool,
    portal_like_generic_page: bool,
) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return True
    if _looks_like_low_value_article_tail_line(normalized):
        return True
    if _looks_like_short_label_cluster(normalized):
        return True
    if _contains_terminal_ellipsis(normalized):
        return True
    if (
        portal_like_generic_page
        and seen_primary_narrative
        and block_role in {"paragraph", "link", "list_item"}
        and _looks_like_headline_only_fragment(normalized)
    ):
        return True
    return False


def _looks_like_low_value_article_tail_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if OFFICIAL_WEB_LOW_VALUE_QR_SIGNUP_PATTERN.match(normalized):
        return True
    if OFFICIAL_WEB_LOW_VALUE_ACTIVITY_POINTS_PATTERN.match(normalized):
        return True
    return False
