from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionReport,
)

worker = importlib.import_module("campus_ingestion_worker.rebuild_authenticated_notice_source_projections")


class RebuildAuthenticatedNoticeSourceProjectionsWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.rebuild_authenticated_notice_source_projections.load_worker_env"),
            patch(
                "campus_ingestion_worker.rebuild_authenticated_notice_source_projections.rebuild_authenticated_notice_source_projections"
            ) as rebuild,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            rebuild.return_value = AuthenticatedNoticeSourceProjectionReport(
                corpus="campus_notices",
                collection="internal_notice",
                parent_notice_count=1,
                attachment_ref_count=3,
                projected_attachment_count=2,
                text_extractable_attachment_count=1,
                ocr_attachment_count=1,
                reference_only_attachment_count=1,
                created_document_ids=("notice_attachment:muc_internal_portal:355119:attachment-0001",),
                updated_document_ids=("notice:muc_internal_portal:355119",),
                skipped_document_ids=(),
                errors=(),
            )
            worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--source-projections-path",
                    "/tmp/internal-notice-source-projections.v1.json",
                    "--default-visibility-scope",
                    "campus",
                ]
            )

        request = rebuild.call_args.kwargs["request"]
        self.assertEqual(request.corpus, "campus_notices")
        self.assertEqual(request.collection, "internal_notice")
        self.assertEqual(str(request.source_projections_path), "/tmp/internal-notice-source-projections.v1.json")
        self.assertEqual(request.default_visibility_scope, "campus")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["projected_attachment_count"], 2)


if __name__ == "__main__":
    unittest.main()
