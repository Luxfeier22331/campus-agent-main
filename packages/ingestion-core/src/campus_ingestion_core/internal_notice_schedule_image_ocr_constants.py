from __future__ import annotations

import re
from typing import Literal

ScheduleImageOcrConfidence = Literal["high", "medium", "low"]
ScheduleImageOcrAdmissionStatus = Literal["admitted", "rejected"]

_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_TEMPORAL_SCOPE_HINT_RE = re.compile(
    r"(20\d{2}年)?\d{1,2}月\d{1,2}日|"
    r"\d{1,2}月\d{1,2}日?\s*(?:至|到|-|—|~|～)\s*\d{1,2}月?\d{1,2}日?|"
    r"\d{1,2}月\d{1,2}日?起|"
    r"(?:每)?周[一二三四五六日天](?:\s*(?:至|到|-|—|~|～|、|,|，|和|及)\s*(?:周)?[一二三四五六日天])*|"
    r"星期[一二三四五六日天](?:\s*(?:至|到|-|—|~|～|、|,|，|和|及)\s*(?:星期)?[一二三四五六日天])*|"
    r"工作日|周末|每日|每天|法定节假日|节假日|寒假|暑假|假期|近期|本周"
)
_ROUTE_HINTS = (
    "海淀校区",
    "丰台校区",
    "海淀",
    "丰台",
    "地铁",
    "接驳",
    "班车",
    "通勤",
    "专车",
    "校车",
)
_GUIDE_HINTS = ("预约", "扫码", "扫一扫", "服务门户", "企业微信", "民大通", "约满即止")
DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL = "https://api.openai.com/v1"
DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS = 2200
DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY = (
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE = (
    "ingestion_projection.internal_notice_schedule_image_ocr_attempt"
)
