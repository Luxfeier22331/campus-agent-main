from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.audit_wechat_public_notice_state")


class AuditWeChatPublicNoticeStateWorkerCliTest(unittest.TestCase):
    def test_main_writes_report_and_repair_selection(self) -> None:
        report = _AuditReport(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            selected_notice_ids=("woa_article_alpha",),
            projection_entry_count=1,
            read_model_entry_count=1,
            completed_admission_batch_count=1,
            suspect_notice_count=1,
            suspect_unit_count=1,
            orphan_read_model_unit_count=0,
            reproject_notice_ids=("woa_article_alpha",),
            purge_notice_ids=(),
            suspect_units=(
                _SuspectUnit(
                    source_notice_id="woa_article_alpha",
                    unit_id="notice_unit:wechat:woa_article_alpha:notice_window",
                    suspicion_codes=("missing_admission_batch_id",),
                    recovery_action="reproject",
                    consumer_admission_batch_id="",
                ),
            ),
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "selection.json"
            with (
                patch("campus_ingestion_worker.audit_wechat_public_notice_state.load_worker_env"),
                patch(
                    "campus_ingestion_worker.audit_wechat_public_notice_state.audit_wechat_public_notice_state",
                    return_value=report,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--notice-id",
                        "woa_article_alpha",
                        "--repair-selection-output-path",
                        str(output_path),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["reproject_notice_ids"], ["woa_article_alpha"])
            selection_payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(selection_payload["reproject_notice_ids"], ["woa_article_alpha"])
            self.assertEqual(selection_payload["purge_notice_ids"], [])


@dataclass(frozen=True, slots=True)
class _SuspectUnit:
    source_notice_id: str
    unit_id: str
    suspicion_codes: tuple[str, ...]
    recovery_action: str
    consumer_admission_batch_id: str


@dataclass(frozen=True, slots=True)
class _AuditReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    read_model_entry_count: int
    completed_admission_batch_count: int
    suspect_notice_count: int
    suspect_unit_count: int
    orphan_read_model_unit_count: int
    reproject_notice_ids: tuple[str, ...]
    purge_notice_ids: tuple[str, ...]
    suspect_units: tuple[_SuspectUnit, ...]


if __name__ == "__main__":
    unittest.main()
