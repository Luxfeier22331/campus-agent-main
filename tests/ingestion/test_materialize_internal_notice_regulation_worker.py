from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_regulation_materialization import (
    InstitutionalRegulationMaterializationReport,
)


_MODULE_NAME = "campus_ingestion_worker.materialize_internal_notice_regulation_candidates"


class MaterializeInternalNoticeRegulationWorkerCliTest(unittest.TestCase):
    def test_main_builds_request_and_prints_report(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        report = InstitutionalRegulationMaterializationReport(
            promotion_candidate_count=2,
            materialized_document_count=2,
            created_document_ids=("institutional_regulation:muc:guideline:abc12345",),
            updated_document_ids=(),
            source_notice_ids=("100001", "100003"),
            source_document_ids=(
                "notice_attachment:muc_internal_portal:100001:attachment-0001",
                "notice:muc_internal_portal:100003",
            ),
            raw_asset_id="asset:internal-notice-regulation-promotion",
            raw_version_id="sha256:test-promotion-run",
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.materialize_institutional_regulations_from_internal_notice_scope"
            ) as materialize,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            materialize.return_value = report
            worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--promotion-routing-path",
                    "/tmp/promotion-routing.v1.json",
                    "--notice-id",
                    "100003",
                    "--notice-id",
                    "100001",
                    "--document-id",
                    "notice:muc_internal_portal:100003",
                ]
            )

        request = materialize.call_args.kwargs["request"]
        self.assertEqual(request.corpus, "campus_notices")
        self.assertEqual(request.collection, "internal_notice")
        self.assertEqual(str(request.promotion_routing_path), "/tmp/promotion-routing.v1.json")
        self.assertEqual(request.notice_ids, ("100001", "100003"))
        self.assertEqual(request.document_ids, ("notice:muc_internal_portal:100003",))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["promotion_candidate_count"], 2)
        self.assertEqual(payload["raw_asset_id"], "asset:internal-notice-regulation-promotion")


if __name__ == "__main__":
    unittest.main()
