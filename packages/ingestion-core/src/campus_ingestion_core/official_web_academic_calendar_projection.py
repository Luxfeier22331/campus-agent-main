from __future__ import annotations

import html
import re


def build_academic_calendar_typed_candidate(
    *,
    lines: list[str],
    candidate_blocks: list[dict[str, object]],
    normalized_canonical_url: str,
    title: str,
) -> dict[str, object]:
    calendar_records = extract_academic_calendar_records(lines)
    academic_year_label = next(
        (
            str(record.get("academic_year_label") or "").strip()
            for record in calendar_records
            if str(record.get("academic_year_label") or "").strip()
        ),
        "",
    )
    term_label = next(
        (
            str(record.get("term_label") or "").strip()
            for record in calendar_records
            if str(record.get("term_label") or "").strip()
        ),
        "",
    )
    date_range = next(
        (
            f"{record['start_date']} 至 {record['end_date']}"
            for record in calendar_records
            if str(record.get("start_date") or "").strip()
            and str(record.get("end_date") or "").strip()
        ),
        "",
    )
    holiday_name = next(
        (
            str(record.get("holiday_name") or "").strip()
            for record in calendar_records
            if str(record.get("holiday_name") or "").strip()
        ),
        "",
    )
    week_index = next(
        (
            int(record.get("week_index") or 0)
            for record in calendar_records
            if isinstance(record.get("week_index"), int) and int(record.get("week_index")) > 0
        ),
        0,
    )
    class_day_pattern = next(
        (
            str(record.get("class_day_pattern") or "").strip()
            for record in calendar_records
            if str(record.get("class_day_pattern") or "").strip()
        ),
        "",
    )
    return {
        "academic_year_label": academic_year_label,
        "term_label": term_label,
        "date_range": date_range,
        "calendar_arrangement": "\n".join(
            line
            for line in lines
            if any(token in line for token in ("教学周", "放假", "补课", "校历"))
        ).strip(),
        "holiday_name": holiday_name,
        "week_index": week_index,
        "class_day_pattern": class_day_pattern,
        "records": calendar_records,
        "calendar_image_refs": extract_academic_calendar_image_refs(candidate_blocks),
        "source_url": normalized_canonical_url,
        "source_title": title,
    }


def extract_academic_calendar_records(lines: list[str]) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    current_year = ""
    current_term = ""
    for line in lines:
        normalized = line.strip()
        if not normalized:
            continue
        year_match = re.search(r"((?:20\d{2})-(?:20\d{2})学年)", normalized)
        if year_match:
            current_year = year_match.group(1)
        if "秋季学期" in normalized:
            current_term = "秋季学期"
        elif "春季学期" in normalized:
            current_term = "春季学期"
        week_match = re.search(
            r"第\s*(\d{1,2})\s*教学周[：:]\s*(\d{4}-\d{2}-\d{2})\s*(?:至|-)\s*(\d{4}-\d{2}-\d{2})",
            normalized,
        )
        if week_match:
            records.append(
                {
                    "academic_year_label": current_year,
                    "term_label": current_term,
                    "start_date": week_match.group(2),
                    "end_date": week_match.group(3),
                    "week_index": int(week_match.group(1)),
                    "day_kind": "teaching_day",
                    "class_day_pattern": "",
                    "is_makeup_class": False,
                    "holiday_name": "",
                }
            )
        holiday_match = re.search(
            r"(\d{4}-\d{2}-\d{2})\s*(?:至|-)\s*(\d{4}-\d{2}-\d{2}).*(劳动节|国庆|元旦|清明|端午|中秋).*(放假)",
            normalized,
        )
        if holiday_match:
            records.append(
                {
                    "academic_year_label": current_year,
                    "term_label": current_term,
                    "start_date": holiday_match.group(1),
                    "end_date": holiday_match.group(2),
                    "week_index": 0,
                    "day_kind": "holiday",
                    "class_day_pattern": "",
                    "is_makeup_class": False,
                    "holiday_name": f"{holiday_match.group(3)}假期",
                }
            )
        makeup_match = re.search(
            r"(\d{4}-\d{2}-\d{2}).*(补课|执行周[一二三四五六日天]课表)", normalized
        )
        if makeup_match:
            records.append(
                {
                    "academic_year_label": current_year,
                    "term_label": current_term,
                    "start_date": makeup_match.group(1),
                    "end_date": makeup_match.group(1),
                    "week_index": 0,
                    "day_kind": "makeup_class_day",
                    "class_day_pattern": (
                        "执行周一课表" if "执行周一课表" in normalized else makeup_match.group(2)
                    ),
                    "is_makeup_class": True,
                    "holiday_name": "",
                }
            )
    return records


def block_has_academic_calendar_image_ref(block: dict[str, object]) -> bool:
    return _block_has_image_ref(block) and _is_academic_calendar_image_block(block)


def extract_academic_calendar_image_refs(blocks: list[dict[str, object]]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    for block in blocks:
        if not _is_academic_calendar_image_block(block):
            continue
        html_fragment = str(block.get("htmlFragment") or block.get("html_fragment") or "")
        link_target = str(block.get("linkTarget") or block.get("link_target") or "").strip()
        if not (html_fragment or link_target):
            continue
        image_url = link_target if _looks_like_image_url(link_target) else ""
        if not image_url:
            image_url = _image_src_from_html_fragment(html_fragment)
        if not image_url:
            continue
        refs.append(
            {
                "source_url": image_url,
                "alt_text": _image_alt_from_html_fragment(html_fragment),
                "row_id": str(block.get("rowId") or block.get("row_id") or "").strip(),
            }
        )
    return _unique_image_refs(refs)


def _block_has_image_ref(block: dict[str, object]) -> bool:
    link_target = str(block.get("linkTarget") or block.get("link_target") or "")
    html_fragment = str(block.get("htmlFragment") or block.get("html_fragment") or "")
    return _looks_like_image_url(link_target) or bool(
        re.search(r"<\s*img\b", html_fragment, re.IGNORECASE)
    )


def _is_academic_calendar_image_block(block: dict[str, object]) -> bool:
    if bool(block.get("isNavigation")) or bool(block.get("is_navigation")):
        return False
    if bool(block.get("isBoilerplate")) or bool(block.get("is_boilerplate")):
        return False
    html_fragment = str(block.get("htmlFragment") or block.get("html_fragment") or "")
    link_target = str(block.get("linkTarget") or block.get("link_target") or "")
    alt_text = _image_alt_from_html_fragment(html_fragment)
    context_text = " ".join(
        str(value or "")
        for value in (
            block.get("sectionHint"),
            block.get("section_hint"),
            block.get("parentHeadingHint"),
            block.get("parent_heading_hint"),
            " ".join(str(item or "") for item in _list_value(block.get("parentHeadingPath"))),
            " ".join(str(item or "") for item in _list_value(block.get("parent_heading_path"))),
            alt_text,
            block.get("textNormalized"),
            block.get("text_normalized"),
            block.get("textRaw"),
            block.get("text_raw"),
        )
    )
    if _has_academic_calendar_context(context_text):
        return True
    if re.search(r"""class\s*=\s*(['"])[^'"]*\bimg_vsb_content\b[^'"]*\1""", html_fragment):
        return True
    return "/__local/" in link_target and not re.search(
        r"/(?:images|img|static|assets)/", link_target, re.IGNORECASE
    )


def _has_academic_calendar_context(value: str) -> bool:
    return any(
        token in value
        for token in (
            "校历",
            "教学周",
            "学期",
            "放假",
            "补课",
            "假期",
            "academic calendar",
            "calendar",
        )
    )


def _list_value(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _looks_like_image_url(value: str) -> bool:
    return bool(re.search(r"\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$", value, re.IGNORECASE))


def _image_src_from_html_fragment(fragment: str) -> str:
    match = re.search(
        r"""(?:src|orisrc|data-src|vurl)\s*=\s*(['"])(?P<value>.+?)\1""",
        fragment,
        re.IGNORECASE,
    )
    return html.unescape(match.group("value")).strip() if match else ""


def _image_alt_from_html_fragment(fragment: str) -> str:
    match = re.search(r"""alt\s*=\s*(['"])(?P<value>.*?)\1""", fragment, re.IGNORECASE)
    return html.unescape(match.group("value")).strip() if match else ""


def _unique_image_refs(refs: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    unique_refs: list[dict[str, str]] = []
    for ref in refs:
        source_url = ref["source_url"].strip()
        if not source_url or source_url in seen:
            continue
        seen.add(source_url)
        unique_refs.append(ref)
    return unique_refs
