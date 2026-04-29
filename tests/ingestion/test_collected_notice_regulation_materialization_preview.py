from __future__ import annotations

import json
import unittest

from campus_ingestion_core.collected_notice_regulation_materialization_preview import (
    PHASE_06_R3_ID,
    build_collected_notice_regulation_materialization_preview,
    preview_to_output_files,
)


def _owner_text_ref(source_notice_id: str) -> dict[str, object]:
    prefix = f"authenticated_notice_portal/file-release-{source_notice_id}/source-truth"
    return {
        "bucket": "campus-rag-source",
        "key": f"{prefix}/searchable-merge-input.json",
        "role": "searchable_merge_input",
    }


def _admitted_entry(
    *,
    source_notice_id: str,
    title: str,
    regulation_class: str,
    target_collection: str,
    candidate_key: str,
    target_identity_preview: str,
) -> dict[str, object]:
    return {
        "entry_id": f"notice:muc_internal_portal:{source_notice_id}",
        "source_channel": "authenticated_notice_portal",
        "source_surface": "file_release",
        "source_corpus": "authenticated_documents",
        "source_collection": "file_release_source",
        "site_id": "muc_internal_portal",
        "source_notice_id": source_notice_id,
        "source_document_id": f"file-release:muc_internal_portal:{source_notice_id}",
        "title": title,
        "published_at": "2024-11-16 18:58:28",
        "source_url": f"https://my.muc.edu.cn/file/{source_notice_id}.pdf",
        "source_object_refs": [
            {
                "bucket": "campus-rag-source",
                "key": f"authenticated_notice_portal/file-release-{source_notice_id}/source.pdf",
                "role": "released_file",
            }
        ],
        "consumption_class": "downstream_admitted",
        "regulation_admission_class": regulation_class,
        "target": "regulation",
        "target_surface": f"regulations/{target_collection}",
        "target_collection": target_collection,
        "target_identity_preview": target_identity_preview,
        "candidate_key": candidate_key,
        "regulation_title_normalized": title,
        "issuing_org": "中央民族大学",
        "duplicate_primary_source_notice_id": None,
        "duplicate_primary_searchable_unit_id": None,
        "target_hints": {"candidate_targets": ["regulation"]},
        "multimodal_policy": "completed",
        "owner_text_status": "ready",
        "owner_text_recovery": {
            "provider": "mineru_api",
            "model": "vlm",
            "written_refs": {"searchable_merge_input": _owner_text_ref(source_notice_id)},
        },
        "reason_codes": ["owner_text_recovered"],
        "preconditions": [
            "searchable_unit_present",
            "source_object_refs_present",
            "regulation_candidate_audit_passed",
        ],
        "searchable_unit_id": f"searchable:file_release:muc_internal_portal:{source_notice_id}",
    }


class CollectedNoticeRegulationMaterializationPreviewTests(unittest.TestCase):
    def test_preview_separates_targets_and_preserves_source_scope(self) -> None:
        institutional = _admitted_entry(
            source_notice_id="594",
            title="中央民族大学毕业生就业奖励办法",
            regulation_class="institutional_rules_candidate",
            target_collection="institutional_rules",
            candidate_key="regulation-candidate:institutional_rules:employment",
            target_identity_preview="institutional_regulation:muc:employment-rule",
        )
        scoped = _admitted_entry(
            source_notice_id="620",
            title="中央民族大学研究生支教团成员规定",
            regulation_class="scoped_rules_candidate",
            target_collection="scoped_rules",
            candidate_key="regulation-candidate:scoped_rules:volunteer",
            target_identity_preview="institutional_regulation:muc:volunteer-rule",
        )
        manual = dict(scoped)
        manual.update(
            {
                "source_notice_id": "619",
                "consumption_class": "defer",
                "regulation_admission_class": "manual_review",
                "target_collection": None,
                "target_surface": None,
                "target_identity_preview": None,
            }
        )
        object_store = _FakeObjectStore(
            {
                ("campus-rag-source", _owner_text_ref("594")["key"]): _merge_bytes(
                    "关于印发《中央民族大学毕业生就业奖励办法》的通知\n\n"
                    "学校各单位、各部门：\n\n"
                    "《中央民族大学毕业生就业奖励办法》已经学校研究通过，"
                    "现印发给你们，请遵照执行。\n\n"
                    "中央民族大学毕业生就业奖励办法\n\n"
                    "第一章总则\n\n"
                    "第一条 为做好毕业生就业奖励工作，制定本办法。\n\n"
                    "第二章奖励范围\n\n"
                    "第二条 本办法适用于学校毕业生。"
                ),
                ("campus-rag-source", _owner_text_ref("620")["key"]): _merge_bytes(
                    "中央民族大学研究生支教团成员规定\n\n"
                    "第一条 为规范研究生支教团成员选拔，制定本规定。"
                ),
            }
        )

        preview = build_collected_notice_regulation_materialization_preview(
            admission_manifest={"entries": [institutional, scoped, manual]},
            object_store=object_store,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.institutional_rules_materialization["phase"], PHASE_06_R3_ID)
        self.assertFalse(preview.institutional_rules_materialization["write_enabled"])
        self.assertEqual(preview.institutional_rules_materialization["document_count"], 1)
        self.assertEqual(preview.scoped_rules_materialization["document_count"], 1)
        institutional_doc = preview.institutional_rules_materialization["documents"][0]
        scoped_doc = preview.scoped_rules_materialization["documents"][0]
        self.assertEqual(institutional_doc["target_collection"], "institutional_rules")
        self.assertEqual(scoped_doc["target_collection"], "scoped_rules")
        self.assertNotIn("594", institutional_doc["target_document_id"])
        self.assertNotIn("现印发", institutional_doc["canonical_markdown_preview"])
        self.assertNotIn("》的通知", institutional_doc["canonical_markdown_preview"])
        self.assertNotIn("学校各单位", institutional_doc["canonical_markdown_preview"])
        self.assertEqual(institutional_doc["normalization_quality"]["quality_verdict"], "passed")
        self.assertGreaterEqual(len(institutional_doc["document_units_preview"]), 2)
        self.assertEqual(
            institutional_doc["document_units_preview"][0]["unit_type"],
            "chapter",
        )
        self.assertEqual(
            institutional_doc["source_scope"]["source_collection"],
            "file_release_source",
        )
        self.assertEqual(preview.consistency_report["verdict"], "passed")
        self.assertEqual(preview.consistency_report["counts"]["downstream_admitted"], 2)
        self.assertEqual(preview.consistency_report["counts"]["skipped_not_admitted"], 1)
        self.assertEqual(preview.normalization_quality_report["verdict"], "passed")
        self.assertEqual(preview.normalization_quality_report["document_count"], 2)

    def test_duplicate_provenance_aggregates_same_candidate_key(self) -> None:
        first = _admitted_entry(
            source_notice_id="701",
            title="中央民族大学科研经费管理办法",
            regulation_class="institutional_rules_candidate",
            target_collection="institutional_rules",
            candidate_key="regulation-candidate:institutional_rules:research",
            target_identity_preview="institutional_regulation:muc:research-fund-rule",
        )
        duplicate = _admitted_entry(
            source_notice_id="702",
            title="中央民族大学科研经费管理办法",
            regulation_class="institutional_rules_candidate",
            target_collection="institutional_rules",
            candidate_key="regulation-candidate:institutional_rules:research",
            target_identity_preview="institutional_regulation:muc:research-fund-rule",
        )
        object_store = _FakeObjectStore(
            {
                ("campus-rag-source", _owner_text_ref("701")["key"]): _merge_bytes(
                    "中央民族大学科研经费管理办法\n\n第一条 为规范科研经费管理，制定本办法。"
                ),
                ("campus-rag-source", _owner_text_ref("702")["key"]): _merge_bytes(
                    "中央民族大学科研经费管理办法\n\n第一条 为规范科研经费管理，制定本办法。"
                ),
            }
        )

        preview = build_collected_notice_regulation_materialization_preview(
            admission_manifest={"entries": [first, duplicate]},
            object_store=object_store,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.institutional_rules_materialization["document_count"], 1)
        document = preview.institutional_rules_materialization["documents"][0]
        self.assertEqual(document["source_notice_ids"], ["701", "702"])
        duplicate_report = preview.duplicate_provenance_aggregation_report
        self.assertEqual(duplicate_report["duplicate_group_count"], 1)
        self.assertEqual(
            duplicate_report["groups"][0]["source_notice_ids"],
            ["701", "702"],
        )
        self.assertEqual(
            set(preview_to_output_files(preview)),
            {
                "institutional-rules-materialization.normalized.dry-run.json",
                "scoped-rules-materialization.normalized.dry-run.json",
                "duplicate-provenance-aggregation-report.json",
                "regulation-normalization-before-after-report.json",
                "regulation-normalization-consistency-report.json",
                "regulation-normalization-quality-report.json",
                "regulation-source-to-target-trace.json",
            },
        )


def _merge_bytes(owner_text: str) -> bytes:
    return (
        json.dumps(
            {
                "schema_version": "regulation_owner_text_searchable_merge_input_v1",
                "owner_text_ready": True,
                "owner_text": owner_text,
            },
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


if __name__ == "__main__":
    unittest.main()
