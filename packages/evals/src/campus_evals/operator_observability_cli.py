from __future__ import annotations

import argparse


def build_publish_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish operator observability grades/backlinks to app-api from eval artifacts.",
    )
    parser.add_argument(
        "--case-results", required=True, help="Path to run-XX-case-results.json artifact."
    )
    parser.add_argument(
        "--request-correlations",
        required=False,
        help=(
            "Optional explicit case_id -> request_id/trace_id correlation manifest. "
            "If omitted, use inline request_correlation from case-results."
        ),
    )
    parser.add_argument(
        "--grade-source", required=True, help="Stable producer/source id for app-api grade upserts."
    )
    parser.add_argument(
        "--grader-version", required=True, help="Grader/runtime version label for published grades."
    )
    parser.add_argument(
        "--metric-domain-override",
        action="append",
        default=[],
        help=(
            "Optional metric-to-domain override in the form "
            "adapter.metric=grounding|citation|policy|intent."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the publish batch but do not POST to app-api.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render publish summary as text or JSON.",
    )
    return parser


__all__ = ["build_publish_parser"]
