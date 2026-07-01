from __future__ import annotations

import os
from collections.abc import Mapping

from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeMultimodalAttemptStore,
)


def build_wechat_public_notice_multimodal_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> WeChatPublicNoticeMultimodalAttemptStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("wechat public notice multimodal attempt store")


__all__ = ["build_wechat_public_notice_multimodal_attempt_store_from_env"]
