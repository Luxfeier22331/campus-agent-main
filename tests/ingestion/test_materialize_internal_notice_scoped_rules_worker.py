from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_scoped_rule_materialization import (
    InternalNoticeScopedRuleMaterializationReport,
)

_MODULE_NAME = "campus_ingestion_worker.materialize_internal_notice_scoped_rules"


class MaterializeInternalNoticeScopedRulesWorkerCliTest(unittest.TestCase):
    def test_main_builds_request_and_prints_report(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        report = InternalNoticeScopedRuleMaterializationReport(
            scoped_rule_candidate_count=3,
            materialized_document_count=2,
            created_document_ids=("institutional_regulation:muc:scoped-rule:abc12345",),
            updated_document_ids=(),
            document_nature_counts={
                "annual_cycle_rule": 2,
                "time_bound_operational_rule": 1,
            },
            source_notice_ids=("191176", "191705", "351907"),
            source_document_ids=(
                "notice:muc_internal_portal:191176",
                "notice:muc_internal_portal:191705",
            ),
            raw_asset_id="asset:internal-notice-scoped-rules-materialization",
            raw_version_id="sha256:test-scoped-rules",
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.materialize_scoped_rules_from_internal_notice_scope"
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
                    "191176",
                    "--notice-id",
                    "191705",
                ]
            )

        request = materialize.call_args.kwargs["request"]
        self.assertEqual(request.corpus, "campus_notices")
        self.assertEqual(request.collection, "internal_notice")
        self.assertEqual(str(request.promotion_routing_path), "/tmp/promotion-routing.v1.json")
        self.assertEqual(request.notice_ids, ("191176", "191705"))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["scoped_rule_candidate_count"], 3)
        self.assertEqual(
            payload["raw_asset_id"],
            "asset:internal-notice-scoped-rules-materialization",
        )


if __name__ == "__main__":
    unittest.main()
