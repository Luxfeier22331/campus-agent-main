# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_collected_notice_regulation_first_batch_promotion_support import *


class CollectedNoticeRegulationFirstBatchPromotionTestsPart02(unittest.TestCase):
    def test_execute_rejects_unexpected_existing_target_id_collision(self) -> None:
        registry = InMemoryDocumentRegistry(
            (
                _existing_scoped_rule_record(
                    document_id="institutional_regulation:muc:620",
                    units_key="regulations/documents/scoped_rules/colliding/document-units.jsonl",
                ),
            )
        )
        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
        )
        scoped = _materialization_report(
            target_collection="scoped_rules",
            documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
        )

        with self.assertRaisesRegex(ValueError, "unexpected existing target collision"):
            materialize_first_batch_regulation_selection(
                selection=build_first_batch_regulation_selection(
                    candidate_audit=_candidate_audit(),
                    consistency_report=_consistency_report(),
                    institutional_materialization=institutional,
                    scoped_materialization=scoped,
                    selected_notice_ids=("594", "620"),
                ),
                institutional_materialization=institutional,
                scoped_materialization=scoped,
                registry=registry,
                raw_asset_registry=InMemoryRawAssetRegistry(),
                object_store=_FakeObjectStore(_source_ref_objects()),
                execute=True,
                env=_object_store_env(),
            )

    def test_provenance_hardening_updates_existing_selected_records(self) -> None:
        selection = build_first_batch_regulation_selection(
            candidate_audit=_candidate_audit(),
            consistency_report=_consistency_report(),
            institutional_materialization=_materialization_report(
                target_collection="institutional_rules",
                documents=[
                    _target_document(source_notice_id="594", collection="institutional_rules")
                ],
            ),
            scoped_materialization=_materialization_report(
                target_collection="scoped_rules",
                documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
            ),
            selected_notice_ids=("594", "620"),
        )
        registry = InMemoryDocumentRegistry(
            (
                _existing_regulation_record(
                    document_id="institutional_regulation:muc:594",
                    collection="institutional_rules",
                ),
                _existing_regulation_record(
                    document_id="institutional_regulation:muc:620",
                    collection="scoped_rules",
                ),
            )
        )

        report = harden_first_batch_regulation_registry_provenance(
            selection=selection,
            registry=registry,
            execute=True,
            generated_at="2026-04-30T00:00:00+00:00",
        )

        self.assertTrue(report["write_enabled"])
        self.assertEqual(report["updated_record_count"], 2)
        updated = registry.latest_versions(
            "institutional_regulation:muc:594",
            revision_track="current-effective",
        )[0]
        self.assertEqual(updated.source_channel, "authenticated_notice_portal")
        self.assertEqual(updated.source_uri, "https://my.muc.edu.cn/file/594.pdf")
        self.assertEqual(
            [observation.source_channel for observation in updated.source_observations],
            ["authenticated_notice_portal", "manual_curated"],
        )
        rerun_report = harden_first_batch_regulation_registry_provenance(
            selection=selection,
            registry=registry,
            execute=False,
            generated_at="2026-04-30T00:01:00+00:00",
        )

        self.assertEqual(rerun_report["candidate_update_count"], 0)
        self.assertEqual(rerun_report["updated_target_document_ids"], [])
        self.assertEqual(
            rerun_report["unchanged_target_document_ids"],
            [
                "institutional_regulation:muc:594",
                "institutional_regulation:muc:620",
            ],
        )


if __name__ == "__main__":
    unittest.main()
