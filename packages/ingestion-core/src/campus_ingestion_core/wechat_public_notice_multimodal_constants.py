from __future__ import annotations

import re
from typing import Literal

WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA = "wechat_public_notice_inline_image_fetch.v1"
WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA = "wechat_public_notice_inline_image_ocr.v1"
WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE = "wechat_public_notice_inline_image_ocr"
WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION = "wechat_public_notice_inline_image_ocr.v1"
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL = "https://api.openai.com/v1"
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS = 2200
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_TIMEOUT_SECONDS = 90.0
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY = (
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL"
)
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY = (
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE = (
    "ingestion_projection.wechat_public_notice_multimodal_attempt"
)
_IMAGE_CONTENT_TYPE_RE = re.compile(r"^image/[a-z0-9.+-]+$", re.IGNORECASE)

WeChatPublicNoticeImageStatus = Literal[
    "pending",
    "admitted",
    "no_extractable_text",
    "fetch_failed",
    "ocr_failed",
]
WeChatPublicNoticeMultimodalConfidence = Literal["high", "medium", "low"]
