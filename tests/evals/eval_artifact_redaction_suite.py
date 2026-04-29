from __future__ import annotations

import unittest

from campus_contracts import WorkflowTraceSummary
from campus_evals.models import reject_forbidden_workflow_trace_keys


class EvalArtifactRedactionSuite(unittest.TestCase):
    def test_eval_redaction_rejects_secret_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace value"):
            reject_forbidden_workflow_trace_keys(
                {"source_url": "https://example.test/download?token=secret-value"},
                "artifact_payload",
            )

    def test_contract_trace_redaction_rejects_secret_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace value"):
            WorkflowTraceSummary(
                tool_argument_summary={
                    "download_url": "https://example.test/file?sso_tgc=secret-value"
                }
            )


if __name__ == "__main__":
    unittest.main()
