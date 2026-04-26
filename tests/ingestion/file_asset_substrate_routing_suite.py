from .file_asset_substrate_support import *


class FileAssetRoutingSubstrateTest(unittest.TestCase):
    def test_infer_raw_asset_typed_metadata_classifies_pdf_as_document_pdf(self) -> None:
        result = infer_raw_asset_typed_metadata(
            source_path=Path("中央民族大学培养方案.pdf"),
            file_bytes=b"%PDF-1.7 sample fixture",
        )

        self.assertEqual(result.asset_kind, "document")
        self.assertEqual(result.asset_subkind, "pdf")
        self.assertEqual(result.file_extension, ".pdf")

    def test_select_online_ocr_routing_prefers_mineru_for_pdf(self) -> None:
        decision = select_online_ocr_routing(
            asset_kind="document",
            asset_subkind="pdf",
            mineru_available=True,
        )

        self.assertTrue(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "pdf_mineru_primary_with_paddle_fallback")
        self.assertEqual(decision.canonical_provider, "mineru_api")
        self.assertEqual(decision.fallback_provider, "paddleocr_async_jobs")

    def test_refined_spatial_image_stays_fail_closed_after_dual_run(self) -> None:
        initial_typed_metadata = RawAssetTypedMetadata(
            content_type="image/png",
            file_extension=".png",
            byte_size=2048,
            page_count=1,
            image_width=1920,
            image_height=1080,
            asset_kind="image",
            asset_subkind="generic_image",
            classification_confidence=1.0,
        )
        candidate_summary = {
            "provider": "mineru_api",
            "usable_output": True,
            "structure_signals": {
                "table_row_count": 0,
                "nonempty_line_count": 2,
                "image_reference_count": 1,
            },
        }
        baseline_summary = {
            "provider": "paddleocr_async_jobs",
            "usable_output": True,
            "structure_signals": {
                "table_row_count": 0,
                "nonempty_line_count": 1,
                "image_reference_count": 0,
            },
        }
        adjudication = {"winner": "candidate", "reason_codes": []}

        refined = refine_raw_asset_typed_metadata_with_ocr_evidence(
            typed_metadata=initial_typed_metadata,
            source_name="campus-map.png",
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
            adjudication=adjudication,
        )
        decision = select_adjudicated_image_routing(
            refined_asset_subkind=refined.asset_subkind,
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
        )

        self.assertEqual(refined.asset_subkind, "spatial_image")
        self.assertFalse(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "spatial_image_deferred")
