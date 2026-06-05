from __future__ import annotations

import re

_FULL_DATE_RE = re.compile(r"(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?")
_YEARLESS_SINGLE_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")
_CHINESE_DATE_RANGE_RE = re.compile(
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?\s*"
    r"(?:至|到|\-|—|~|～)\s*"
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?"
)
_ORDINAL_RE = re.compile(r"^\d+[\.、]?$")
_BODY_TEXT_SPLIT_RE = re.compile(r"[\n。；;]")
_MARKDOWN_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+")
_SERVICE_STOP_KEYWORDS = ("停运", "暂停", "停止运营", "不运行")
_REJECTED_SOURCE_SCHEMA_VERSION = "transport_schedule_rejected_sources.v1"
