from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.preview_official_transport_baseline")


class PreviewOfficialTransportBaselineWorkerTests(unittest.TestCase):
    def test_main_writes_no_write_baseline_evidence_from_ocr_text(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-6-2"
            ocr_text_path = tmp_path / "ocr.md"
            ocr_text_path.write_text(
                """
表1 师生通勤班车班次表 (新增班次3月20日起执行)
<table>
<tr><td>星期</td><td>线路</td><td>序号</td><td>发车时间</td><td>类型</td><td>备注</td></tr>
<tr><td>周一至周五</td><td>海淀校区→丰台校区</td><td>1</td><td>6:40</td><td>教师班次</td><td></td></tr>
</table>
""",
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_official_transport_baseline.load_worker_env"
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--ocr-plain-text-path",
                        str(ocr_text_path),
                        "--output-dir",
                        str(output_dir),
                        "--source-ref",
                        "official_transport_baseline:test",
                        "--provider",
                        "fixture",
                        "--model",
                        "fixture-model",
                    ]
                )

            expected_files = {
                "official-baseline-canonical-preview.json",
                "official-baseline-consistency-report.json",
                "official-baseline-ocr-plain-text.md",
                "official-baseline-ocr-probe-report.json",
            }
            self.assertEqual({path.name for path in output_dir.iterdir()}, expected_files)
            payload = json.loads(stdout.getvalue())
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["canonical_row_count"], 1)
            self.assertEqual(payload["consistency_verdict"], "passed")


if __name__ == "__main__":
    unittest.main()
