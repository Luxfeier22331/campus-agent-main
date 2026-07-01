from __future__ import annotations

import json
import unittest

from campus_ingestion_core.curriculum_program_family_facts_projection import (
    build_curriculum_program_family_facts_scope_refresh_documents,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument


class CurriculumProgramFamilyFactsProjectionTest(unittest.TestCase):
    def test_build_scope_refresh_documents_emits_direct_answer_family_facts(self) -> None:
        documents = build_curriculum_program_family_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-family-facts-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campus-agent://source/curriculum/curriculum-plan.pdf",
                content_hash="program-family-facts-001",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-02T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:synthetic-public-affairs-plan",
                    title="Synthetic public affairs curriculum plan",
                    page_start=1,
                    page_end=3,
                ),
                SplitManifestDocument(
                    document_id="curriculum:synthetic-data-systems-plan",
                    title="Synthetic data systems curriculum plan",
                    page_start=4,
                    page_end=6,
                    entitlement_groups=("campus_members",),
                    visibility_scope="campus",
                ),
            ),
        )

        self.assertEqual(
            [document.collection for document in documents],
            ["program_family_facts", "program_family_facts"],
        )
        self.assertEqual(
            [document.title for document in documents],
            [
                "Synthetic cross-campus program family",
                "Synthetic public program family",
            ],
        )

    def test_scope_refresh_document_units_embed_program_family_semantics_in_metadata(self) -> None:
        documents = build_curriculum_program_family_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-family-facts-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campus-agent://source/curriculum/curriculum-plan.pdf",
                content_hash="program-family-facts-001",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-02T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:synthetic-public-affairs-plan",
                    title="Synthetic public affairs curriculum plan",
                    page_start=1,
                    page_end=3,
                ),
                SplitManifestDocument(
                    document_id="curriculum:synthetic-data-systems-plan",
                    title="Synthetic data systems curriculum plan",
                    page_start=4,
                    page_end=6,
                    entitlement_groups=("campus_members",),
                    visibility_scope="campus",
                ),
            ),
        )

        first_row = json.loads(documents[0].document_units_bytes.decode("utf-8").splitlines()[0])

        self.assertIn("metadata", first_row)
        self.assertEqual(
            first_row["metadata"]["canonical_program_family_id"],
            "program_family:synthetic.cross_campus_programs",
        )
        self.assertEqual(first_row["metadata"]["content_role"], "family_membership")
        self.assertEqual(first_row["metadata"]["detail_label"], "成员专业")
        self.assertEqual(
            first_row["metadata"]["member_program_titles"],
            [
                "Synthetic public affairs curriculum plan",
                "Synthetic data systems curriculum plan",
            ],
        )
        self.assertTrue(first_row["metadata"]["is_answer_bearing"])


if __name__ == "__main__":
    unittest.main()
