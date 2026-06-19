from __future__ import annotations

import unittest

from .curriculum_course_map_multimodal_probe_test_support import *


class CurriculumCourseMapMultimodalProbeAsyncTest(unittest.TestCase):
    def test_async_run_preserves_sample_order_even_when_completion_is_out_of_order(self) -> None:
        sample_one = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p001",
            page_number=1,
            document_id="curriculum:one",
            document_title="方案一",
            row_id="row-1",
            parent_heading_hint="课程地图一",
            provider_bbox=(1.0, 2.0, 3.0, 4.0),
            provider_canvas=(100.0, 200.0),
            pdf_bbox=(1.0, 2.0, 3.0, 4.0),
            full_page_png=b"one-full",
            crop_png=b"one-crop",
        )
        sample_two = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p002",
            page_number=2,
            document_id="curriculum:two",
            document_title="方案二",
            row_id="row-2",
            parent_heading_hint="课程地图二",
            provider_bbox=(1.0, 2.0, 3.0, 4.0),
            provider_canvas=(100.0, 200.0),
            pdf_bbox=(1.0, 2.0, 3.0, 4.0),
            full_page_png=b"two-full",
            crop_png=b"two-crop",
        )

        async def fake_probe(**kwargs):
            rendered_sample = kwargs["rendered_sample"]
            if rendered_sample.sample_id == "course-map-p001":
                await asyncio.sleep(0.02)
            return _make_page_probe(
                sample_id=rendered_sample.sample_id,
                page_number=rendered_sample.page_number,
                document_id=rendered_sample.document_id,
                document_title=rendered_sample.document_title,
                map_title=rendered_sample.parent_heading_hint,
                nodes=("节点一",),
                edges=(),
            )

        with patch.object(
            _probe_module, "_probe_curriculum_course_map_page_async", side_effect=fake_probe
        ):
            run = asyncio.run(
                _probe_module._run_curriculum_course_map_probe_run_async(
                    run_index=1,
                    source={
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY": "test",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_MODEL": "gpt-test",
                    },
                    rendered_samples=(sample_one, sample_two),
                    output_dir=None,
                    prompt_transport="chat_completions",
                    max_inflight_pages=2,
                    max_request_attempts=1,
                    resume=False,
                    http_client=None,
                )
            )

        self.assertEqual(
            [page.sample_id for page in run.pages], ["course-map-p001", "course-map-p002"]
        )

    def test_post_probe_json_async_retries_cloudflare_520(self) -> None:
        first_response = httpx.Response(
            520,
            request=httpx.Request("POST", "https://example.test/v1/chat/completions"),
            text="unknown error",
        )
        second_response = httpx.Response(
            200,
            request=httpx.Request("POST", "https://example.test/v1/chat/completions"),
            json={"ok": True},
        )

        class _FakeAsyncClient:
            def __init__(self, responses: list[httpx.Response]) -> None:
                self._responses = list(responses)

            async def post(
                self, url: str, *, json: dict[str, object], headers: dict[str, str]
            ) -> httpx.Response:
                return self._responses.pop(0)

        fake_client = _FakeAsyncClient([first_response, second_response])
        attempts: list[dict[str, object]] = []

        async def record_attempt(row: dict[str, object]) -> None:
            attempts.append(row)

        async def fake_sleep(_: float) -> None:
            return None

        with patch.object(_probe_module.asyncio, "sleep", new=fake_sleep):
            payload = asyncio.run(
                _probe_module._post_probe_json_async(
                    http_client=fake_client,
                    path="/chat/completions",
                    payload={"model": "gpt-5.4"},
                    api_key="test-key",
                    max_request_attempts=2,
                    on_attempt=record_attempt,
                    run_index=3,
                    sample_id="course-map-p601",
                    transport="chat_completions",
                    stage="extract",
                    map_index=1,
                )
            )

        self.assertEqual(payload, {"ok": True})
        self.assertEqual([row["status"] for row in attempts], [520, 200])

    def test_request_course_map_detector_payload_async_sends_chat_completion_response_format(
        self,
    ) -> None:
        rendered_sample = CurriculumCourseMapRenderedSample(
            sample_id="course-map-p349",
            page_number=349,
            document_id="curriculum:law",
            document_title="法学方案",
            row_id="row-1",
            parent_heading_hint="六、课程地图",
            provider_bbox=(100.0, 200.0, 900.0, 1000.0),
            provider_canvas=(1200.0, 1600.0),
            pdf_bbox=(50.0, 80.0, 450.0, 480.0),
            full_page_png=b"full",
            crop_png=b"crop",
        )
        captured_payloads: list[dict[str, object]] = []

        async def fake_post_probe_json_async(**kwargs):
            captured_payloads.append(kwargs["payload"])
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": '{"detected_maps":[]}',
                        }
                    }
                ]
            }

        with patch.object(
            _probe_module, "_post_probe_json_async", side_effect=fake_post_probe_json_async
        ):
            payload = asyncio.run(
                _request_course_map_detector_payload_async(
                    transport="chat_completions",
                    source={
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY": "test",
                        "CURRICULUM_COURSE_MAP_MULTIMODAL_MODEL": "gpt-test",
                    },
                    rendered_sample=rendered_sample,
                    http_client=object(),
                    max_request_attempts=1,
                    on_attempt=lambda row: asyncio.sleep(0),
                    run_index=1,
                )
            )

        self.assertEqual(payload["detected_maps"], [])
        self.assertEqual(captured_payloads[0]["response_format"]["type"], "json_schema")
