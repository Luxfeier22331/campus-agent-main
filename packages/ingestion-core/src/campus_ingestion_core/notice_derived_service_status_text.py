from __future__ import annotations

import re

_BOARDING_POINT_KEYWORDS = ("乘车点", "上车点", "下车点")
_CHANGE_KEYWORDS = ("更改", "调整", "优化", "变更")
_SUSPENSION_KEYWORDS = ("暂停运营", "暂停运行", "停止运营", "停运", "不运行")
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s*")
_SPACE_RE = re.compile(r"\s+")
_SEGMENT_SPLIT_RE = re.compile(r"[\n。；;]")


def _clean_text(value: object) -> str:
    return _SPACE_RE.sub(" ", str(value or "").strip())


def _contains_boarding_point_change(text: str) -> bool:
    return any(keyword in text for keyword in _BOARDING_POINT_KEYWORDS) and any(
        keyword in text for keyword in _CHANGE_KEYWORDS
    )


def _contains_suspension(text: str) -> bool:
    return any(keyword in text for keyword in _SUSPENSION_KEYWORDS)


def _status_note(text: str) -> str:
    for segment in _SEGMENT_SPLIT_RE.split(text):
        cleaned = _clean_status_note_segment(segment)
        if not cleaned:
            continue
        if _is_status_note_title_segment(cleaned):
            continue
        if _looks_like_status_segment(cleaned):
            return cleaned
    return _clean_status_note_segment(text[:240])


def _clean_status_note_segment(value: object) -> str:
    return _MARKDOWN_HEADING_RE.sub("", _clean_text(value)).strip()


def _is_status_note_title_segment(text: str) -> bool:
    return text.startswith("关于") and text.endswith(("通知", "公告", "安排"))


def _looks_like_status_segment(text: str) -> bool:
    return (
        _contains_boarding_point_change(text)
        or _contains_suspension(text)
        or any(
            keyword in text
            for keyword in (
                "暂停访问",
                "暂停使用",
                "暂停办理",
                "暂停服务",
                "暂停开放",
                "升级维护",
                "关闭",
                "闭馆",
                "开馆",
                "停止使用",
                "正常开放",
                "正常使用",
                "开放时间",
                "临时关闭",
                "试运行",
                "恢复办理",
                "恢复开放",
                "放假期间",
                "服务日期",
                "服务时间",
                "门诊时间",
                "开诊时间",
                "值班安排",
                "增开",
            )
        )
    )


def _service_counter_relevant_text(text: str) -> str:
    text = _clean_text(_text_without_leading_markdown_title(text))
    service_hall_starts = [
        text.rfind(marker)
        for marker in ("综合服务大厅", "一站式服务中心")
        if text.rfind(marker) >= 0
    ]
    if service_hall_starts:
        start = max(service_hall_starts)
    else:
        hospital_start = text.find("校医院")
        if hospital_start < 0:
            return text
        start = 0
    tail = text[start:]
    end_markers = ("特此通知", "如有特殊情况", "中央民族大学校医院", "校医院 2026", "后勤保障处")
    ends = [tail.find(marker) for marker in end_markers if tail.find(marker) > 0]
    if ends:
        tail = tail[: min(ends)]
    return tail


def _text_without_leading_markdown_title(value: object) -> str:
    lines = str(value or "").splitlines()
    while lines and not lines[0].strip():
        lines = lines[1:]
    if lines and _MARKDOWN_HEADING_RE.match(lines[0].strip()):
        return "\n".join(lines[1:]).strip()
    return str(value or "")
