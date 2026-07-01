from __future__ import annotations

import json
import unittest

from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    rebuild_wechat_public_notice_projection,
)


class _FakeObjectStore:
    def __init__(self, payloads: dict[tuple[str, str], bytes]) -> None:
        self.payloads = payloads

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.payloads[(bucket, key)]


class WeChatPublicNoticeProjectionStoreConfigTest(unittest.TestCase):
    def test_rebuild_requires_explicit_store_when_not_dry_run_and_env_is_unconfigured(
        self,
    ) -> None:
        refs = WeChatSourceTruthArtifactRefs(
            article_manifest_key="wechat/source-truth/article-manifest.json",
            content_blocks_key="wechat/source-truth/content-blocks.jsonl",
            media_refs_key="wechat/source-truth/media-refs.jsonl",
            bucket="source",
        )
        object_store = _FakeObjectStore(
            {
                ("source", refs.article_manifest_key): json.dumps({}).encode(),
                ("source", refs.content_blocks_key): b"",
                ("source", refs.media_refs_key): b"",
            }
        )

        with self.assertRaisesRegex(RuntimeError, "Python database runtime is retired"):
            rebuild_wechat_public_notice_projection(
                request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
                env={},
                object_store=object_store,
            )


if __name__ == "__main__":
    unittest.main()
