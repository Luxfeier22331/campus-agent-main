from __future__ import annotations

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
)

WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL = "wechat_official_account"
WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY = NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC
WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS = "campus_notices"
WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION = "wechat_public_notice"
WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE = "notice_window"
WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER = "notice_body"
WECHAT_PUBLIC_NOTICE_SOURCE_LABEL = "wechat_public_notice_projection_v1"

_FORBIDDEN_SOURCE_TRUTH_FIELDS = frozenset(
    {
        "document_id",
        "doc_id",
        "version_id",
        "revision_track",
        "chunk_id",
        "chunk_order",
        "embedding",
        "visibility_level",
        "visibility_scope",
        "entitlement_groups",
        "policy_projection_version",
    }
)
