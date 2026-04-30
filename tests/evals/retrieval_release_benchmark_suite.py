from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.retrieval_release_benchmark import (
    build_retrieval_release_benchmark_report_from_jsonl,
    retrieval_release_benchmark_report_to_dict,
)
from campus_evals.retrieval_release_benchmark_cli import main as benchmark_main


class RetrievalReleaseBenchmarkTest(unittest.TestCase):
    def test_builds_dry_run_report_from_chunk_jsonl_with_scaled_cost_estimate(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chunks_path = root / "chunks.jsonl"
            chunks_path.write_text(
                "\n".join(
                    (
                        json.dumps(
                            {
                                "doc_id": "doc-a",
                                "chunk_id": "chunk-a1",
                                "clean_text": "校园卡补办流程",
                                "metadata": {"final_token_count": 8},
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "doc_id": "doc-b",
                                "chunk_id": "chunk-b1",
                                "clean_text": "学生证补办地点",
                                "metadata": {"final_token_count": 7},
                            },
                            ensure_ascii=False,
                        ),
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            report = build_retrieval_release_benchmark_report_from_jsonl(
                chunks_path=chunks_path,
                corpus="regulations",
                collection="student_rules",
                scale_multiplier=5,
                mode="dry_run",
            )
            payload = retrieval_release_benchmark_report_to_dict(report)

        self.assertEqual(payload["schema_version"], "retrieval-release-benchmark-report-v1")
        self.assertEqual(payload["scope"], {"corpus": "regulations", "collection": "student_rules"})
        self.assertEqual(payload["mode"], "dry_run")
        self.assertEqual(payload["scale_multiplier"], 5)
        self.assertEqual(payload["counts"]["document_count"], 2)
        self.assertEqual(payload["counts"]["chunk_count"], 2)
        self.assertEqual(payload["counts"]["scaled_chunk_count"], 10)
        self.assertEqual(payload["counts"]["token_estimate"], 15)
        self.assertEqual(payload["counts"]["scaled_token_estimate"], 75)
        self.assertEqual(payload["embedding"]["provider_call_count_estimate"], 10)
        self.assertFalse(payload["alias_publish"]["mutated"])

    def test_cli_writes_json_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chunks_path = root / "chunks.jsonl"
            output_path = root / "report.json"
            chunks_path.write_text(
                json.dumps(
                    {
                        "document_id": "doc-a",
                        "chunk_id": "chunk-a1",
                        "text": "一卡通挂失",
                        "metadata": {"final_token_count": 6},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            exit_code = benchmark_main(
                [
                    "--chunks",
                    str(chunks_path),
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--scale-multiplier",
                    "3",
                    "--output",
                    str(output_path),
                ]
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["counts"]["scaled_chunk_count"], 3)
        self.assertEqual(payload["alias_publish"]["status"], "not_attempted")


if __name__ == "__main__":
    unittest.main()
