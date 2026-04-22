from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.operator_observability import (
    OperatorRequestCorrelation,
    load_request_correlation_manifest,
)


class OperatorObservabilityManifestTest(unittest.TestCase):
    def test_load_request_correlation_manifest_reads_case_level_request_truth(self) -> None:
        payload = {
            "schema_version": 1,
            "cases": [
                {
                    "case_id": "case-1",
                    "request_id": "req_01",
                    "trace_id": "trace_01",
                    "sampled_at": "2026-04-03T00:10:00.000Z",
                    "trace_link": "https://sentry.example/traces/trace_01",
                    "issue_link": "https://sentry.example/issues/42",
                    "issue_fingerprint": "citation-missing",
                }
            ],
        }

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "correlations.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            correlations = load_request_correlation_manifest(path)

        self.assertEqual(tuple(correlations.keys()), ("case-1",))
        self.assertEqual(
            correlations["case-1"],
            OperatorRequestCorrelation(
                case_id="case-1",
                request_id="req_01",
                trace_id="trace_01",
                sampled_at="2026-04-03T00:10:00.000Z",
                trace_link="https://sentry.example/traces/trace_01",
                issue_link="https://sentry.example/issues/42",
                issue_fingerprint="citation-missing",
            ),
        )
