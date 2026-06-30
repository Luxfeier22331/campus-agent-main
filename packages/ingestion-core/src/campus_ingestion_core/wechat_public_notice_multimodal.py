from __future__ import annotations

from campus_ingestion_core.wechat_public_notice_multimodal_artifacts import (
    build_wechat_public_notice_inline_image_artifact_keys,
    list_wechat_public_notice_inline_image_refs,
    load_wechat_public_notice_inline_image_outcome,
    write_wechat_public_notice_inline_image_fetch_manifest,
    write_wechat_public_notice_inline_image_ocr_manifest,
)
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION,
    WeChatPublicNoticeImageStatus,
    WeChatPublicNoticeMultimodalConfidence,
)
from campus_ingestion_core.wechat_public_notice_multimodal_db import (
    InMemoryWeChatPublicNoticeMultimodalAttemptStore,
    PostgresWeChatPublicNoticeMultimodalAttemptStore,
    build_wechat_public_notice_multimodal_attempt_store_from_env,
)
from campus_ingestion_core.wechat_public_notice_multimodal_images import (
    fetched_image_object_key,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeDocumentRegistry,
    WeChatPublicNoticeFetchedInlineImage,
    WeChatPublicNoticeInlineImageArtifactKeys,
    WeChatPublicNoticeInlineImageOutcome,
    WeChatPublicNoticeInlineImageRef,
    WeChatPublicNoticeMultimodalAttempt,
    WeChatPublicNoticeMultimodalAttemptStore,
    WeChatPublicNoticeMultimodalItemReport,
    WeChatPublicNoticeMultimodalObjectStore,
    WeChatPublicNoticeMultimodalProcessingReport,
    WeChatPublicNoticeMultimodalProvider,
    WeChatPublicNoticeMultimodalProviderRequest,
    WeChatPublicNoticeMultimodalProviderResult,
)
from campus_ingestion_core.wechat_public_notice_multimodal_processing import (
    process_wechat_public_notice_pending_multimodal_entries,
)
from campus_ingestion_core.wechat_public_notice_multimodal_provider import (
    ChatCompletionsWeChatPublicNoticeMultimodalProvider,
)
from campus_ingestion_core.wechat_public_notice_multimodal_registry import (
    upsert_wechat_public_notice_inline_image_registry_record,
)
from campus_ingestion_core.wechat_public_notice_multimodal_selection import (
    select_wechat_public_notice_pending_multimodal_notice_ids,
)

__all__ = [
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION",
    "ChatCompletionsWeChatPublicNoticeMultimodalProvider",
    "InMemoryWeChatPublicNoticeMultimodalAttemptStore",
    "PostgresWeChatPublicNoticeMultimodalAttemptStore",
    "WeChatPublicNoticeDocumentRegistry",
    "WeChatPublicNoticeFetchedInlineImage",
    "WeChatPublicNoticeImageStatus",
    "WeChatPublicNoticeInlineImageArtifactKeys",
    "WeChatPublicNoticeInlineImageOutcome",
    "WeChatPublicNoticeInlineImageRef",
    "WeChatPublicNoticeMultimodalAttempt",
    "WeChatPublicNoticeMultimodalAttemptStore",
    "WeChatPublicNoticeMultimodalConfidence",
    "WeChatPublicNoticeMultimodalItemReport",
    "WeChatPublicNoticeMultimodalObjectStore",
    "WeChatPublicNoticeMultimodalProcessingReport",
    "WeChatPublicNoticeMultimodalProvider",
    "WeChatPublicNoticeMultimodalProviderRequest",
    "WeChatPublicNoticeMultimodalProviderResult",
    "build_wechat_public_notice_inline_image_artifact_keys",
    "build_wechat_public_notice_multimodal_attempt_store_from_env",
    "fetched_image_object_key",
    "list_wechat_public_notice_inline_image_refs",
    "load_wechat_public_notice_inline_image_outcome",
    "process_wechat_public_notice_pending_multimodal_entries",
    "select_wechat_public_notice_pending_multimodal_notice_ids",
    "upsert_wechat_public_notice_inline_image_registry_record",
    "write_wechat_public_notice_inline_image_fetch_manifest",
    "write_wechat_public_notice_inline_image_ocr_manifest",
]
