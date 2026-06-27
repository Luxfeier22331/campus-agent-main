from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.hindsight_memory_product_path import (
    HindsightMemoryObservation,
    HindsightMemoryRuntimeSettings,
    collect_hindsight_memory_runtime_observations,
    evaluate_hindsight_memory_cases,
    load_hindsight_memory_cases,
    run_hindsight_memory_product_path_profile,
)


class HindsightMemoryProductPathSuite(unittest.TestCase):
    def test_loads_default_cases_for_all_hindsight_memory_paths(self) -> None:
        case_set = load_hindsight_memory_cases()

        self.assertEqual(case_set.case_family, "hindsight_memory_product_path.v1")
        self.assertEqual(
            {case.assertion_kind for case in case_set.cases},
            {
                "append_completed_turn",
                "cross_thread_recall",
                "explicit_profile_upsert",
                "explicit_profile_disable",
                "owner_disable",
                "user_isolation",
            },
        )

    def test_evaluator_requires_expected_status_and_tokens(self) -> None:
        case_set = load_hindsight_memory_cases()
        observations = {
            case.case_id: HindsightMemoryObservation(
                case_id=case.case_id,
                status="completed",
                selected_memory_count=case.min_selected_memory_count,
                observed_tokens=case.required_tokens,
                forbidden_tokens=(),
                schema_version=case.required_schema_version,
            )
            for case in case_set.cases
        }
        broken_case = case_set.cases[0]
        observations[broken_case.case_id] = HindsightMemoryObservation(
            case_id=broken_case.case_id,
            status="completed",
            selected_memory_count=0,
            observed_tokens=(),
            forbidden_tokens=(),
            schema_version=broken_case.required_schema_version,
        )

        report = evaluate_hindsight_memory_cases(case_set.cases, observations)
        results = {result.case_id: result for result in report.results}

        self.assertFalse(report.passed)
        self.assertEqual(results[broken_case.case_id].failure_class, "required_token_missing")

    def test_profile_writes_sanitized_report(self) -> None:
        case_set = load_hindsight_memory_cases()
        observations = {
            case.case_id: {
                "status": case.required_status,
                "selected_memory_count": case.min_selected_memory_count,
                "observed_tokens": list(case.required_tokens),
                "schema_version": case.required_schema_version,
            }
            for case in case_set.cases
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps({"observations": observations}, ensure_ascii=False),
                encoding="utf-8",
            )
            report = run_hindsight_memory_product_path_profile(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["profile_id"], "hindsight_memory_product_path")
        self.assertEqual(payload["summary"]["failed"], 0)

    def test_runtime_collector_requires_real_observations_for_every_case(self) -> None:
        seen_paths: list[str] = []

        class RecordingClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                self.base_url = kwargs.get("base_url") or args[0]

            def __enter__(self) -> RecordingClient:
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def post(
                self,
                path: str,
                *,
                json: dict[str, object],
                headers: dict[str, str],
            ) -> object:
                seen_paths.append(path)

                class Response:
                    status_code = 202
                    text = "{}"

                    def __init__(self, payload: dict[str, object]) -> None:
                        self._payload = payload

                    def json(self) -> dict[str, object]:
                        return self._payload

                if path == "/internal/memory/personal/items:upsert":
                    return Response(
                        {
                            "episode_uuid": "episode-live",
                            "memory_id": json["memory_id"],
                            "payload_sha256": "hash",
                            "schema_version": "memory_profile_item_result_v1",
                            "status": "active",
                        }
                    )
                if path == "/internal/memory/personal/items:disable":
                    return Response(
                        {
                            "episode_uuid": json["episode_uuid"],
                            "memory_id": json["memory_id"],
                            "payload_sha256": "hash",
                            "schema_version": "memory_profile_item_result_v1",
                            "status": "disabled",
                        }
                    )
                if path == "/internal/memory/personal/owner:disable":
                    return Response(
                        {
                            "payload_sha256": "hash",
                            "schema_version": "memory_profile_owner_disable_result_v1",
                            "status": "disabled",
                            "user_id": json["user_id"],
                        }
                    )
                if path == "/internal/memory/personal/turns:append":
                    return Response(
                        {
                            "appended_message_count": 2,
                            "payload_sha256": "hash",
                            "schema_version": "memory_conversation_append_result_v1",
                            "status": "completed",
                            "thread_id": json["thread_id"],
                        }
                    )
                if path == "/internal/memory/personal/graph:recall":
                    selected_count = 0 if json["user_id"] == "other-hindsight-memory-user" else 1
                    if "thread_id" not in json:
                        raise AssertionError("recall request must include thread_id")
                    return Response(
                        {
                            "context_block": "用户记忆:\n相关事实:\n- 用户关注丰台校区培养方案"
                            if selected_count
                            else "",
                            "memory_context_items": [
                                {
                                    "compact_text": "用户关注丰台校区培养方案",
                                    "tool": "knowledge_query",
                                    "memory_id": "edge-1",
                                    "memory_type": "fact",
                                    "updated_at": "2026-06-16T10:00:00Z",
                                }
                            ]
                            if selected_count
                            else [],
                            "memory_ref": "projection://runs/live/memory/recall",
                            "payload_sha256": "hash",
                            "provider": "hindsight",
                            "retrieval_mode": "recall",
                            "schema_version": "memory_recall_result_v1",
                            "selected_memory_chars": 42 if selected_count else 0,
                            "selected_memory_count": selected_count,
                            "status": "completed",
                        }
                    )
                raise AssertionError(f"unexpected path: {path}")

        case_set = load_hindsight_memory_cases()
        import campus_evals.hindsight_memory_product_path as module

        original_client = module.httpx.Client
        module.httpx.Client = RecordingClient  # type: ignore[assignment]
        try:
            observations = collect_hindsight_memory_runtime_observations(
                case_set,
                settings=HindsightMemoryRuntimeSettings(
                    execution_control_base_url="http://execution-control.test",
                    worker_shared_secret="secret",
                ),
            )
        finally:
            module.httpx.Client = original_client

        self.assertEqual({case.case_id for case in case_set.cases}, set(observations))
        self.assertNotIn("not_collected", {item.status for item in observations.values()})
        self.assertEqual(
            observations["hindsight-memory-cross-thread-recall"].selected_memory_count, 1
        )
        self.assertEqual(observations["hindsight-memory-user-isolation"].selected_memory_count, 0)
        self.assertLess(
            seen_paths.index("/internal/memory/personal/graph:recall"),
            seen_paths.index("/internal/memory/personal/items:upsert"),
        )


if __name__ == "__main__":
    unittest.main()
