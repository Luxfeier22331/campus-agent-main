from __future__ import annotations

import unittest

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_contact_candidate import (
    build_notice_derived_contact_candidate_bundle,
)

from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _FakeObjectStore,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry


class NoticeDerivedContactCandidateTest(unittest.TestCase):
    def test_builds_stable_contact_candidates_from_contact_update_notice(self) -> None:
        registry, object_store, entry = _runtime(
            notice_id="355131",
            notice_title="关于调整信息化建设管理处一卡通中心办公地点及联系电话的通知",
            body=(
                "# 关于调整信息化建设管理处一卡通中心办公地点及联系电话的通知\n\n"
                "一卡通中心 68932649\n"
            ),
        )

        result = build_notice_derived_contact_candidate_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-27T11:00:00+08:00",
        )

        self.assertEqual(result.candidate_count, 1)
        self.assertEqual(result.rejected_count, 0)
        self.assertEqual(result.manual_review_count, 0)
        record = result.bundle["candidate_records"][0]
        self.assertEqual(record["notice_id"], "355131")
        self.assertEqual(record["display_name"], "一卡通中心")
        self.assertEqual(record["phone_number"], "68932649")
        self.assertEqual(record["candidate_kind"], "stable_contact_phone")

    def test_rejects_activity_contact_notice(self) -> None:
        registry, object_store, entry = _runtime(
            notice_id="355901",
            notice_title="关于创新创业讲座报名及联系人通知",
            body=("# 关于创新创业讲座报名及联系人通知\n\n联系人 张老师：13800000000\n"),
        )

        result = build_notice_derived_contact_candidate_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-04-27T11:00:00+08:00",
        )

        self.assertEqual(result.candidate_count, 0)
        self.assertEqual(result.rejected_count, 1)
        self.assertEqual(
            result.bundle["rejected_records"][0]["reason_code"],
            "temporary_activity_or_recruitment_contact",
        )


def _runtime(*, notice_id: str, notice_title: str, body: str):
    record = _record(
        notice_id=notice_id,
        title_slug=f"{notice_id}-stable-contact",
        content_hash=f"sha256:{notice_id}:stable-contact",
        body_key=f"campus_notices/documents/internal_notice/{notice_id}/canonical.md",
        units_key=f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl",
        is_current=True,
    )
    registry = InMemoryDocumentRegistry((record,))
    object_store = _FakeObjectStore(
        objects={
            ("campus-rag-derived", record.canonical_markdown_object_key): _canonical_markdown(body),
        }
    )
    entry = NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:notice:muc_internal_portal:{notice_id}:stable_contact_update",
        primary_role=NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_notice_release_time="2026-04-27 09:00",
        role_metadata={
            "notice_title": notice_title,
            "site_id": "muc_internal_portal",
        },
    )
    return registry, object_store, entry


if __name__ == "__main__":
    unittest.main()
