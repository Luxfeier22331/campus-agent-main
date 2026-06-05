from __future__ import annotations

import httpx

from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    _IMAGE_CONTENT_TYPE_RE,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_TIMEOUT_SECONDS,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeFetchedInlineImage,
    WeChatPublicNoticeInlineImageFetchRequest,
)


class HttpxWeChatPublicNoticeInlineImageFetcher:
    def __init__(
        self,
        *,
        http_client: httpx.Client | None = None,
        timeout_seconds: float = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_TIMEOUT_SECONDS,
    ) -> None:
        self._http_client = http_client or httpx.Client(
            timeout=httpx.Timeout(
                connect=10.0,
                read=timeout_seconds,
                write=10.0,
                pool=5.0,
            ),
            follow_redirects=True,
            trust_env=False,
        )

    def fetch(
        self,
        request: WeChatPublicNoticeInlineImageFetchRequest,
    ) -> WeChatPublicNoticeFetchedInlineImage:
        response = self._http_client.get(
            request.image_url,
            headers={
                "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                "referer": request.article_source_url,
                "user-agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/136.0 Safari/537.36"
                ),
            },
        )
        response.raise_for_status()
        content_type = str(response.headers.get("content-type") or "").split(";", 1)[0].strip()
        if not _IMAGE_CONTENT_TYPE_RE.match(content_type):
            raise ValueError(
                f"{request.media_ref_id} expected image content-type, got {content_type or 'unknown'}"
            )
        return WeChatPublicNoticeFetchedInlineImage(
            content_type=content_type,
            image_bytes=response.content,
            final_url=str(response.url),
        )
