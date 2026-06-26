from __future__ import annotations

import unittest
from dataclasses import asdict
from pathlib import Path

from campus_contracts.models_notice_change_set import (
    NOTICE_CHANGE_SET_ARTIFACT_KIND,
    NOTICE_CHANGE_SET_DISPLAY_NAME,
    NOTICE_CHANGE_SET_PRODUCER_BINDING_ID,
    NOTICE_CHANGE_SET_PRODUCER_TOOL_NAME,
    NoticeChangeSet,
    NoticeChangeSetConflict,
    NoticeChangeSetEffectiveWindow,
    NoticeChangeSetFact,
    NoticeChangeSetQueryScope,
    NoticeChangeSetSafetySummary,
    NoticeChangeSetSourceRef,
)

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_REGISTRY_PATH = ROOT / "configs/runtime/workflow-artifacts.v2.json"
GO_EXECUTION_PROJECTION_PATH = (
    ROOT / "apps/execution-control/internal/execution/step_output_projection.go"
)
OPENAPI_CONTRACT_PATH = ROOT / "docs/contracts/schemas/capability-execution.openapi.yaml"


class ContractModelsNoticeChangeSetSuite(unittest.TestCase):
    def test_contract_names_match_closed_artifact_registry_binding(self) -> None:
        import json

        registry = json.loads(ARTIFACT_REGISTRY_PATH.read_text(encoding="utf-8"))
        artifacts = {item["kind"]: item for item in registry["artifacts"]}
        bindings = {item["binding_id"]: item for item in registry["bindings"]}
        notice_change_set = artifacts[NOTICE_CHANGE_SET_ARTIFACT_KIND]
        notice_change_set_binding = bindings[NOTICE_CHANGE_SET_PRODUCER_BINDING_ID]

        self.assertEqual(notice_change_set["display_name"], NOTICE_CHANGE_SET_DISPLAY_NAME)
        self.assertEqual(notice_change_set["owner_capability"], "notice")
        self.assertEqual(
            notice_change_set["producer_tools"],
            [NOTICE_CHANGE_SET_PRODUCER_TOOL_NAME],
        )
        self.assertEqual(notice_change_set["source_truth_owner"], "notice_consumption_projection")
        self.assertEqual(notice_change_set["current_projection_support"], "planned_contract_gap")
        self.assertEqual(notice_change_set_binding["opening_gate"], "closed")
        self.assertEqual(
            notice_change_set_binding["tool_name"], NOTICE_CHANGE_SET_PRODUCER_TOOL_NAME
        )
        self.assertEqual(notice_change_set_binding["produces"], [NOTICE_CHANGE_SET_ARTIFACT_KIND])

    def test_notice_change_set_projection_contract_remains_registered(self) -> None:
        go_projection_text = GO_EXECUTION_PROJECTION_PATH.read_text(encoding="utf-8")
        openapi_text = OPENAPI_CONTRACT_PATH.read_text(encoding="utf-8")

        self.assertIn(f'"{NOTICE_CHANGE_SET_ARTIFACT_KIND}"', go_projection_text)
        self.assertIn(f"- {NOTICE_CHANGE_SET_ARTIFACT_KIND}", openapi_text)

    def test_answer_eligible_transport_overlay_requires_source_backed_facts(self) -> None:
        change_set = _answer_eligible_change_set()

        payload = asdict(change_set)

        self.assertEqual(NOTICE_CHANGE_SET_ARTIFACT_KIND, "notice_change_set")
        self.assertEqual(
            NOTICE_CHANGE_SET_PRODUCER_BINDING_ID,
            "notice.notice_change_set.transport_override_lookup",
        )
        self.assertEqual(NOTICE_CHANGE_SET_PRODUCER_TOOL_NAME, "campus_notice_change_set_lookup")
        self.assertEqual(payload["schema_version"], "notice-change-set-v1")
        self.assertEqual(payload["target_family"], "transport_schedule")
        self.assertTrue(payload["answer_eligible"])
        self.assertEqual(payload["admission_state"], "answer_eligible")
        self.assertEqual(payload["source_refs"][0]["title"], "关于两校区学生通勤班车增加班次的通知")
        self.assertEqual(payload["facts"][0]["source_ref_id"], "notice-ref:355122")

    def test_answer_eligible_change_set_rejects_missing_source_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_url must not be empty"):
            NoticeChangeSetSourceRef(
                source_ref_id="notice-ref:355122",
                notice_id="355122",
                title="关于两校区学生通勤班车增加班次的通知",
                source_url="",
                published_at="2026-03-18",
            )

    def test_answer_eligible_change_set_rejects_fact_without_matching_source_ref(self) -> None:
        source = _source_ref()
        fact = NoticeChangeSetFact(
            fact_id="fact:orphan",
            fact_kind="departure_time_added",
            change_text="新增学生通勤班车班次。",
            source_notice_id="355122",
            source_ref_id="notice-ref:missing",
        )

        with self.assertRaisesRegex(
            ValueError,
            "notice change fact source_ref_id must exist in source_refs",
        ):
            NoticeChangeSet(
                change_set_id="notice-change-set:test",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(route_labels=("两校区学生通勤班车",)),
                effective_window=NoticeChangeSetEffectiveWindow(
                    starts_at="2026-03-18",
                    timezone="Asia/Shanghai",
                    current_at_query_time=True,
                ),
                change_kind="temporary_overlay",
                answer_eligible=True,
                admission_state="answer_eligible",
                facts=(fact,),
                source_refs=(source,),
                content_hash="sha256:test",
            )

    def test_searchable_only_change_set_cannot_carry_answer_facts(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "non-answer change set must not carry answer facts",
        ):
            NoticeChangeSet(
                change_set_id="notice-change-set:search-only",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(route_labels=("两校区学生通勤班车",)),
                effective_window=NoticeChangeSetEffectiveWindow(timezone="Asia/Shanghai"),
                change_kind="historical_search_only",
                answer_eligible=False,
                admission_state="searchable_only",
                facts=(_fact(),),
                source_refs=(_source_ref(),),
                content_hash="sha256:test",
            )

    def test_missing_baseline_change_set_requires_fail_close_reason(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "fail-closed change set must carry fail_close_reasons",
        ):
            NoticeChangeSet(
                change_set_id="notice-change-set:missing-baseline",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(route_labels=("两校区学生通勤班车",)),
                effective_window=NoticeChangeSetEffectiveWindow(timezone="Asia/Shanghai"),
                change_kind="no_current_change",
                answer_eligible=False,
                admission_state="missing_baseline",
                content_hash="sha256:test",
            )

    def test_missing_evidence_change_set_accepts_stable_fail_close_reason(self) -> None:
        change_set = NoticeChangeSet(
            change_set_id="notice-change-set:missing-evidence",
            target_family="transport_schedule",
            query_scope=NoticeChangeSetQueryScope(route_labels=("地铁接驳车",)),
            effective_window=NoticeChangeSetEffectiveWindow(timezone="Asia/Shanghai"),
            change_kind="no_current_change",
            answer_eligible=False,
            admission_state="missing_evidence",
            fail_close_reasons=("notice_media_evidence_incomplete",),
            source_refs=(_source_ref(),),
            content_hash="sha256:test",
        )

        self.assertFalse(change_set.answer_eligible)
        self.assertEqual(change_set.fail_close_reasons, ("notice_media_evidence_incomplete",))

    def test_conflict_change_set_requires_conflict_summary(self) -> None:
        source = _source_ref()
        with self.assertRaisesRegex(
            ValueError, "conflict change set must carry conflict summaries"
        ):
            NoticeChangeSet(
                change_set_id="notice-change-set:conflict",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(route_labels=("两校区教师通勤班车",)),
                effective_window=NoticeChangeSetEffectiveWindow(
                    starts_at="2026-03-05",
                    current_at_query_time=True,
                ),
                change_kind="temporary_overlay",
                answer_eligible=False,
                admission_state="conflict",
                fail_close_reasons=("transport_notice_conflict",),
                source_refs=(source,),
                content_hash="sha256:test",
            )

    def test_conflict_change_set_rejects_unknown_conflict_source_ref(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "notice change conflict source_ref_ids must exist in source_refs",
        ):
            NoticeChangeSet(
                change_set_id="notice-change-set:conflict",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(route_labels=("两校区教师通勤班车",)),
                effective_window=NoticeChangeSetEffectiveWindow(
                    starts_at="2026-03-05",
                    current_at_query_time=True,
                ),
                change_kind="temporary_overlay",
                answer_eligible=False,
                admission_state="conflict",
                fail_close_reasons=("transport_notice_conflict",),
                source_refs=(_source_ref(),),
                conflicts=(
                    NoticeChangeSetConflict(
                        conflict_id="conflict:1",
                        reason="same route has conflicting current windows",
                        source_ref_ids=("notice-ref:missing",),
                    ),
                ),
                content_hash="sha256:test",
            )

    def test_safety_summary_rejects_raw_payload_key_families(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "notice_change_set payload key is forbidden",
        ):
            NoticeChangeSetSafetySummary(payload_key_names=("raw_ocr_dump",))

    def test_answer_eligible_temporary_overlay_requires_effective_window(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires an effective window"):
            NoticeChangeSet(
                change_set_id="notice-change-set:no-window",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(route_labels=("两校区学生通勤班车",)),
                effective_window=NoticeChangeSetEffectiveWindow(timezone="Asia/Shanghai"),
                change_kind="temporary_overlay",
                answer_eligible=True,
                admission_state="answer_eligible",
                facts=(_fact(),),
                source_refs=(_source_ref(),),
                content_hash="sha256:test",
            )


def _answer_eligible_change_set() -> NoticeChangeSet:
    return NoticeChangeSet(
        change_set_id="notice-change-set:355122:student-commute",
        target_family="transport_schedule",
        query_scope=NoticeChangeSetQueryScope(
            campus="all",
            route_labels=("两校区学生通勤班车",),
            direction_labels=("双向",),
            query_time_anchor="2026-05-07T09:00:00+08:00",
            service_date="2026-05-07",
        ),
        effective_window=NoticeChangeSetEffectiveWindow(
            starts_at="2026-03-18",
            timezone="Asia/Shanghai",
            current_at_query_time=True,
        ),
        change_kind="temporary_overlay",
        answer_eligible=True,
        admission_state="answer_eligible",
        facts=(_fact(),),
        source_refs=(_source_ref(),),
        content_hash="sha256:355122",
        safety_summary=NoticeChangeSetSafetySummary(
            payload_key_names=(
                "schema_version",
                "facts",
                "source_refs",
                "effective_window",
            )
        ),
    )


def _source_ref() -> NoticeChangeSetSourceRef:
    return NoticeChangeSetSourceRef(
        source_ref_id="notice-ref:355122",
        notice_id="355122",
        title="关于两校区学生通勤班车增加班次的通知",
        source_url="https://example.edu/notice/355122",
        published_at="2026-03-18",
        excerpt="自3月18日起增加两校区学生通勤班车班次。",
    )


def _fact() -> NoticeChangeSetFact:
    return NoticeChangeSetFact(
        fact_id="fact:355122:added-departure",
        fact_kind="departure_time_added",
        route_label="两校区学生通勤班车",
        direction_label="双向",
        service_window={"starts_at": "2026-03-18"},
        change_text="自3月18日起增加两校区学生通勤班车班次。",
        source_notice_id="355122",
        source_ref_id="notice-ref:355122",
        confidence="deterministic",
    )


if __name__ == "__main__":
    unittest.main()
