from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
)

worker = importlib.import_module(
    "campus_ingestion_worker.prepare_internal_notice_regulation_candidate_chunks"
)


def _candidate_document() -> InternalNoticeRegulationCandidateArtifactDocument:
    return InternalNoticeRegulationCandidateArtifactDocument(
        candidate_id="candidate-300101",
        source_document_id="notice:muc_internal_portal:300101",
        notice_id="300101",
        site_id="muc_internal_portal",
        source_kind="attachment_document",
        input_lane="attachment_text_extractable",
        revision_track="source-faithful",
        version_id="sha256:300101:source-faithful",
        promotion_class="formal_regulation",
        document_nature="institutional_regulation",
        semantic_owner_kind="attachment_document",
        target_corpus="regulations",
        target_collection="institutional_regulations",
        regulation_title_normalized="中央民族大学实验室安全管理规定",
        issuing_org="中央民族大学",
        effective_date="2021年2月28日",
        revision_signal="修订",
        source_notice_release_time="2021-02-28 16:09",
        source_parent_document_id="notice:muc_internal_portal:300101",
        source_attachment_ref_id="attachment-0001",
        source_attachment_sha256="sha256:attachment-300101",
        source_uri="https://portal.example.edu/files/300101.docx",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        embedding_model="Qwen3-Embedding-4B",
        is_current=True,
        quality_gates_passed=("canonical_text_available", "provenance_complete"),
        reasons=(),
        promotion_body=(
            "第一条 为加强实验室安全管理，制定本规定。\n\n"
            "第二条 实验室实行分级分类安全管理制度。\n\n"
            "第三条 各实验室应建立日常巡检和安全培训机制。"
        ),
        artifact_markdown_path="candidates/中央民族大学实验室安全管理规定--candidate-300101/canonical.md",
        artifact_body_sha256="sha256:body-300101",
    )


class PrepareInternalNoticeRegulationCandidateChunksWorkerCliTest(unittest.TestCase):
    def test_main_prepares_local_only_chunk_artifacts_from_candidate_jsonl(self) -> None:
        candidate = _candidate_document()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            candidate_jsonl = root / "candidate-documents.jsonl"
            output_dir = root / "prepared"
            candidate_jsonl.write_text(
                json.dumps(asdict(candidate), ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.prepare_internal_notice_regulation_candidate_chunks.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--candidate-documents-jsonl",
                        str(candidate_jsonl),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertTrue(payload["passed"])
            self.assertEqual(payload["prepared_candidate_count"], 1)
            self.assertTrue(Path(payload["manifest_path"]).exists())
            self.assertTrue(Path(payload["validation_summary_path"]).exists())
            self.assertTrue(Path(payload["document_reports_path"]).exists())


if __name__ == "__main__":
    unittest.main()
