from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.regulation_rag_release_lane import (
    build_registry_scope_rag_release_executor,
    build_regulation_rag_release_candidate_store_from_env,
    process_pending_regulation_rag_release_candidates,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Process pending regulation RAG release candidates."
    )
    parser.add_argument("--candidate-id", action="append", default=None)
    parser.add_argument("--acceptance-case-path")
    parser.add_argument("--release-admission-manifest-key")
    parser.add_argument("--component-eval-summary-path")
    parser.add_argument("--reset-index", action="store_true")
    publish_group = parser.add_mutually_exclusive_group()
    publish_group.add_argument("--publish-alias", dest="publish_alias", action="store_true")
    publish_group.add_argument("--no-publish-alias", dest="publish_alias", action="store_false")
    parser.set_defaults(publish_alias=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    component_eval_summary = _load_optional_json_object(args.component_eval_summary_path)
    store = build_regulation_rag_release_candidate_store_from_env(prefer_operator=True)
    executor = build_registry_scope_rag_release_executor(
        acceptance_case_path=args.acceptance_case_path,
        release_admission_manifest_key=args.release_admission_manifest_key,
        component_eval_summary=component_eval_summary,
        publish_alias=args.publish_alias,
        reset_index=args.reset_index,
    )
    report = process_pending_regulation_rag_release_candidates(
        store=store,
        release_executor=executor,
        candidate_ids=tuple(args.candidate_id or ()),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


def _load_optional_json_object(path: str | None) -> dict[str, object] | None:
    candidate = (path or "").strip()
    if not candidate:
        return None
    payload = json.loads(Path(candidate).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("component eval summary payload must be a JSON object")
    return payload


if __name__ == "__main__":
    main()
