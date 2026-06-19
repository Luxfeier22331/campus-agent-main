# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    _settings_from_env,
)

from tests.ingestion.test_internal_notice_multimodal_processing_support import *


class InternalNoticeMultimodalProcessingTestPart02(unittest.TestCase):
    def test_processor_builder_defaults_to_chat_completions_runtime(self) -> None:
        processor = build_internal_notice_multimodal_processor_from_env(
            {
                "INTERNAL_NOTICE_MULTIMODAL_API_KEY": "test-key",
                "INTERNAL_NOTICE_MULTIMODAL_MODEL": "gpt-4.1-mini",
            }
        )

        self.assertIsInstance(processor, ChatCompletionsInternalNoticeMultimodalProcessor)

    def test_processor_builder_rejects_unknown_runtime(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported multimodal runtime"):
            build_internal_notice_multimodal_processor_from_env(
                {
                    "INTERNAL_NOTICE_MULTIMODAL_RUNTIME": "bad-runtime",
                    "INTERNAL_NOTICE_MULTIMODAL_API_KEY": "test-key",
                    "INTERNAL_NOTICE_MULTIMODAL_MODEL": "gpt-4.1-mini",
                }
            )

    def test_processor_builder_requires_internal_notice_specific_credentials(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "INTERNAL_NOTICE_MULTIMODAL_API_KEY is required",
        ):
            build_internal_notice_multimodal_processor_from_env(
                {
                    "LLM_API_KEY": "shared-key",
                    "LLM_MODEL": "gpt-shared",
                    "LLM_BASE_URL": "https://shared.example/v1",
                }
            )

    def test_processor_builder_requires_internal_notice_specific_model(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "INTERNAL_NOTICE_MULTIMODAL_MODEL is required",
        ):
            build_internal_notice_multimodal_processor_from_env(
                {
                    "INTERNAL_NOTICE_MULTIMODAL_API_KEY": "test-key",
                    "LLM_MODEL": "gpt-shared",
                }
            )

    def test_processor_env_settings_ignore_optional_tuning_env(self) -> None:
        settings = _settings_from_env(
            {
                "INTERNAL_NOTICE_MULTIMODAL_API_KEY": "test-key",
                "INTERNAL_NOTICE_MULTIMODAL_MODEL": "gpt-4.1-mini",
                "INTERNAL_NOTICE_MULTIMODAL_BASE_URL": "https://domain.example/v1",
                "INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS": "123",
            }
        )

        self.assertEqual(settings["base_url"], "https://api.openai.com/v1")
        self.assertEqual(settings["max_output_tokens"], 900)

    def test_agents_sdk_processor_returns_normalized_decision_and_ignores_extra_fields(
        self,
    ) -> None:
        processor = AgentsSdkInternalNoticeMultimodalProcessor(
            api_key="test-key",
            model="gpt-4.1-mini",
            runner=_FakeAgentsSdkRunner(
                {
                    "action": "retain_for_notice_query",
                    "summary": "图片列出了班车停靠点。",
                    "extracted_text": "海淀校区西门 7:30 发车",
                    "reasons": ["visual_text_extracted"],
                    "confidence": "high",
                    "raw_provider_payload": {"unsafe": True},
                }
            ),
        )

        decision = processor.process(
            InternalNoticeMultimodalProcessingRequest(
                source_notice_id="351907",
                unit_id="notice_unit:351907:pending_multimodal",
                notice_title="关于班车安排调整的通知",
                primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                reasons=("multimodal_processing_required",),
                attachments=(
                    InternalNoticeMultimodalAttachment(
                        attachment_ref_id="attachment-map",
                        filename="map.png",
                        mime_type="image/png",
                        object_key="notice/351907/attachment-map.png",
                        data=b"PNGDATA",
                    ),
                ),
            )
        )

        self.assertEqual(
            decision,
            InternalNoticeMultimodalDecision(
                action="retain_for_notice_query",
                summary="图片列出了班车停靠点。",
                extracted_text="海淀校区西门 7:30 发车",
                reasons=("visual_text_extracted",),
                confidence="high",
            ),
        )

    def test_agents_sdk_processor_builds_user_input_with_inline_image_items(self) -> None:
        runner = _FakeAgentsSdkRunner(
            {
                "action": "no_adoption",
                "summary": "图片是装饰性配图。",
                "extracted_text": "",
                "reasons": ["decorative_visual_asset"],
                "confidence": "medium",
            }
        )
        processor = AgentsSdkInternalNoticeMultimodalProcessor(
            api_key="test-key",
            model="gpt-4.1-mini",
            runner=runner,
        )

        processor.process(
            InternalNoticeMultimodalProcessingRequest(
                source_notice_id="351907",
                unit_id="notice_unit:351907:pending_multimodal",
                notice_title="关于服务地点调整的通知",
                primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                reasons=("multimodal_processing_required",),
                attachments=(
                    InternalNoticeMultimodalAttachment(
                        attachment_ref_id="attachment-map",
                        filename="map.png",
                        mime_type="image/png",
                        object_key="notice/351907/attachment-map.png",
                        data=b"PNGDATA",
                    ),
                ),
            )
        )

        self.assertEqual(runner.calls[0]["input"][0]["role"], "user")
        content = runner.calls[0]["input"][0]["content"]
        self.assertEqual(content[0]["type"], "input_text")
        self.assertEqual(content[1]["type"], "input_image")
        self.assertTrue(content[1]["image_url"].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
