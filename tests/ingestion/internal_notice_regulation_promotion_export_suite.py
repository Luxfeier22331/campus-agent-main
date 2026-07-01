from __future__ import annotations

import unittest

from .internal_notice_regulation_promotion_test_support import *


class InternalNoticeRegulationPromotionExportTest(unittest.TestCase):
    def test_export_candidate_artifacts_writes_local_only_cleaned_markdown_for_parent_candidate(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:example_internal_portal:200008",
            source_uri="https://portal.example.edu/notices/200008",
            canonical_key="campus_notices/documents/internal_notice/200008/canonical.md",
            units_key="campus_notices/documents/internal_notice/200008/document-units.jsonl",
            content_hash="sha256:parent-200008",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200008",
                    notice_title="关于修订《示例大学采购工作管理办法》的通知",
                    published_date="2021-02-28",
                    notice_release_time="2021-02-28 16:09",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-agent-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《示例大学采购工作管理办法》的通知\n\n"
                    "学校各单位、各部门：\n\n"
                    "现将修订后的《示例大学采购工作管理办法》予以发布，请遵照执行。\n\n"
                    "第一条 为规范学校采购工作，提高资金使用效益，制定本办法。\n\n"
                    "第二条 学校采购活动应遵循公开、公平、公正和诚实信用原则。\n\n"
                    "第三条 校内集中采购限额标准为20万元（含）以上。\n\n"
                    "特此通知。\n\n"
                    "资产管理处（招标采购中心）\n\n"
                    "2021年2月28日\n"
                ),
                ("campus-agent-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于修订《示例大学采购工作管理办法》的通知",
                            "metadata": {"title": "关于修订《示例大学采购工作管理办法》的通知"},
                        }
                    ]
                ),
            }
        )

        manifest, documents = build_internal_notice_regulation_candidate_artifact_manifest(
            request=InternalNoticeRegulationPromotionRequest(notice_ids=("200008",)),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(manifest.exported_candidate_count, 1)
        self.assertEqual(documents[0].source_notice_release_time, "2021-02-28 16:09")
        self.assertEqual(documents[0].entitlement_groups, ("campus_members",))
        self.assertEqual(documents[0].visibility_scope, "campus")
        self.assertEqual(documents[0].visibility_level, "restricted")
        self.assertEqual(documents[0].embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(
            documents[0].source_notice_document_id, "notice:example_internal_portal:200008"
        )
        self.assertEqual(
            documents[0].semantic_owner_document_id, "notice:example_internal_portal:200008"
        )
        self.assertTrue(documents[0].artifact_markdown_path.endswith("/canonical.md"))
        self.assertNotIn("学校各单位、各部门", documents[0].promotion_body)
        self.assertNotIn("特此通知", documents[0].promotion_body)
        self.assertIn("第一条 为规范学校采购工作", documents[0].promotion_body)

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            manifest_path, documents_path = export_internal_notice_regulation_candidate_artifacts(
                output_dir=output_dir,
                manifest=manifest,
                documents=documents,
            )
            self.assertTrue(manifest_path.exists())
            self.assertTrue(documents_path.exists())
            markdown_path = output_dir / documents[0].artifact_markdown_path
            markdown = markdown_path.read_text(encoding="utf-8")
            self.assertIn("# 示例大学采购工作管理办法", markdown)
            self.assertIn("source_notice_release_time: 2021-02-28 16:09", markdown)
            self.assertIn(
                "source_notice_document_id: notice:example_internal_portal:200008", markdown
            )
            self.assertIn(
                "semantic_owner_document_id: notice:example_internal_portal:200008", markdown
            )
            self.assertIn("regulation_work_title: 示例大学采购工作管理办法", markdown)
            self.assertIn("regulation_display_title: 示例大学采购工作管理办法", markdown)
            self.assertIn("第一条 为规范学校采购工作", markdown)
            self.assertNotIn("学校各单位、各部门", markdown)
            self.assertNotIn("特此通知", markdown)
