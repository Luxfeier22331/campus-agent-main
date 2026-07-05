from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.langfuse_eval_audit import audit_langfuse_eval_configuration


class LangfuseEvalAuditTest(unittest.TestCase):
    def test_minimal_current_shape_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_minimal_langfuse_eval_repo(root)

            report = audit_langfuse_eval_configuration(repo_root=root)

        self.assertTrue(report["passed"])

    def test_audit_rejects_retired_ci_surface_contract_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_minimal_langfuse_eval_repo(
                root,
                ci_surface_contract_path="docs/contracts/langfuse-runtime-observability-contract.md",
            )

            report = audit_langfuse_eval_configuration(repo_root=root)

        self.assertFalse(report["passed"])
        self.assertIn(
            {
                "check_id": "langfuse_ci_surface_contract_path",
                "passed": False,
                "active_path_present": False,
                "retired_path_present": True,
            },
            report["checks"],
        )

    def test_audit_rejects_duplicate_selected_tool_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_minimal_langfuse_eval_repo(root, duplicate_selected_tool=True)

            report = audit_langfuse_eval_configuration(repo_root=root)

        self.assertFalse(report["passed"])
        self.assertIn(
            {
                "check_id": "trace_evidence_required_observation_attributes_unique",
                "passed": False,
                "duplicates": ["selected_tool"],
            },
            report["checks"],
        )
        self.assertIn(
            {
                "check_id": "otel_runtime_request_selected_tool_unique",
                "passed": False,
                "count": 2,
            },
            report["checks"],
        )

    def test_audit_rejects_active_eval_doc_regression_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_minimal_langfuse_eval_repo(root)
            _write_text(
                root / "docs/runbooks/eval-ragas.md",
                "aggregate qrels scorer remains a TS eval migration item\n",
            )

            report = audit_langfuse_eval_configuration(repo_root=root)

        self.assertFalse(report["passed"])
        self.assertIn(
            {
                "check_id": "active_eval_doc_regression_tokens_absent",
                "passed": False,
                "present": [
                    {
                        "path": "docs/runbooks/eval-ragas.md",
                        "token": "qrels scorer",
                    }
                ],
            },
            report["checks"],
        )

    def test_audit_rejects_retired_experiment_and_review_automation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_minimal_langfuse_eval_repo(root)
            _write_text(
                root / "packages/eval-langfuse/src/cli.ts",
                """
const commands = ["ragas-score-traces", "ragas-score-dataset",
"build-rag-dataset-manifest", "sync-datasets", "run-experiment"];
export { commands };
""",
            )
            _write_text(
                root / "packages/eval-langfuse/src/platform.ts",
                """
function runLangfuseExperiment() {
  return "langfuse_experiment_manifest.v1";
}
function syncLangfuseAnnotationQueue() {
  return "langfuse_review_manifest.v1";
}
function exportLangfuseReviewResults() {}
""",
            )

            report = audit_langfuse_eval_configuration(repo_root=root)

        self.assertFalse(report["passed"])
        self.assertIn(
            {
                "check_id": "langfuse_cli_retired_commands_absent",
                "passed": False,
                "present": ["run-experiment"],
            },
            report["checks"],
        )
        self.assertIn(
            {
                "check_id": "retired_active_source_tokens_absent",
                "passed": False,
                "present": [
                    {
                        "path": "packages/eval-langfuse/src/platform.ts",
                        "token": "runLangfuseExperiment",
                    },
                    {
                        "path": "packages/eval-langfuse/src/platform.ts",
                        "token": "syncLangfuseAnnotationQueue",
                    },
                    {
                        "path": "packages/eval-langfuse/src/platform.ts",
                        "token": "exportLangfuseReviewResults",
                    },
                    {
                        "path": "packages/eval-langfuse/src/platform.ts",
                        "token": "langfuse_experiment_manifest",
                    },
                    {
                        "path": "packages/eval-langfuse/src/platform.ts",
                        "token": "langfuse_review_manifest",
                    },
                ],
            },
            report["checks"],
        )

    def test_audit_rejects_app_api_eval_ingress_gate_language(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_minimal_langfuse_eval_repo(root)
            _write_text(
                root / "docs/contracts/app-api/eval-benchmark.md",
                "internal eval materialization ingress seam\n"
                "materialization request\n"
                "Langfuse/Ragas materialized dataset run\n"
                "safe trace observation\n"
                "deterministic gate\n",
            )

            report = audit_langfuse_eval_configuration(repo_root=root)

        self.assertFalse(report["passed"])
        self.assertIn(
            {
                "check_id": "app_api_eval_ingress_is_materialization_only",
                "passed": False,
                "missing": [],
                "forbidden": ["deterministic gate"],
            },
            report["checks"],
        )


def _write_minimal_langfuse_eval_repo(
    root: Path,
    *,
    duplicate_selected_tool: bool = False,
    ci_surface_contract_path: str = "docs/contracts/langfuse-runtime.md",
) -> None:
    _write_text(
        root / ".github/workflows/eval-ragas-score.yml",
        """
on:
  workflow_dispatch:
    inputs:
      profile:
        options:
          - ragas-trace
          - ragas-dataset
permissions: {}
jobs:
  eval:
    steps:
      - uses: actions/setup-python@v5
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --all-packages --dev
      - run: pnpm --dir packages/eval-langfuse langfuse ragas-score-traces --runtime-config x --validate-only
      - run: pnpm --dir packages/eval-langfuse langfuse ragas-score-dataset --runtime-config x --validate-only
      - id: publish_langfuse_scores
        run: echo --validate-only
""",
    )
    _write_text(
        root / "scripts/detect_ci_changed_surfaces.py",
        f"""
def _is_langfuse_path(path: str) -> bool:
    return path == {ci_surface_contract_path!r}
""",
    )
    _write_json(
        root / "packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json",
        {
            "schema_version": "langfuse_score_registry.v1",
            "scores": [
                {"name": name, "owner": "packages/ragas-runner"}
                for name in (
                    "ragas.faithfulness",
                    "ragas.answer_relevancy",
                    "ragas.context_precision",
                    "ragas.context_recall",
                    "ragas.context_precision_without_reference",
                    "ragas.id_context_precision",
                    "ragas.id_context_recall",
                )
            ],
        },
    )
    _write_text(
        root / "packages/eval-langfuse/src/cli.ts",
        "\n".join(
            (
                'const commands = ["ragas-score-traces", "ragas-score-dataset",',
                '"build-rag-dataset-manifest", "sync-datasets"];',
                "export { commands };",
                "",
            )
        ),
    )
    selected_tool_lines = ['"selected_tool",']
    if duplicate_selected_tool:
        selected_tool_lines.append('"selected_tool",')
    _write_text(
        root / "packages/eval-langfuse/src/trace-evidence.ts",
        "const REQUIRED_OBSERVATION_ATTRIBUTES = [\n" + "\n".join(selected_tool_lines) + "\n];\n",
    )
    _write_text(
        root / "packages/eval-langfuse/src/ragas-langfuse.ts",
        "\n".join(
            (
                "const error = 'materialized for Ragas scoring';",
                "function ragasEvalFieldsFromTrace() {}",
                "const fields = ['retrieved_contexts', 'reference_context_ids'];",
                "export { error, fields, ragasEvalFieldsFromTrace };",
                "",
            )
        ),
    )
    taxonomy_lines = ["- `selected_tool`"]
    if duplicate_selected_tool:
        taxonomy_lines.append("- `selected_tool`")
    _write_text(
        root / "docs/reference/runtime-otel-telemetry-taxonomy.md",
        "### Runtime / Request Attributes\n\n" + "\n".join(taxonomy_lines) + "\n\n## Next\n",
    )
    _write_text(
        root / "docs/reference/eval-map.md",
        """
## Active Workflow Lanes

`ragas-trace`

`ragas-dataset`

## Retired Surfaces
""",
    )
    _write_text(
        root / "docs/contracts/app-api/eval-benchmark.md",
        """
internal eval materialization ingress seam
materialization request
Langfuse/Ragas materialized dataset run
safe trace observation
""",
    )


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.lstrip(), encoding="utf-8")


def _write_json(path: Path, payload: object) -> None:
    _write_text(path, json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
