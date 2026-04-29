from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    DEFAULT_GOLD_MANIFEST_PATH,
    DEFAULT_MAX_INFLIGHT_PAGES,
    DEFAULT_MAX_REQUEST_ATTEMPTS,
    DEFAULT_PROMPT_RUNS,
    DEFAULT_PROMPT_RUNTIME_TRANSPORT,
    DEFAULT_REPEATABILITY_THRESHOLD,
    DEFAULT_SAMPLE_MANIFEST_PATH,
    DEFAULT_SPLIT_MANIFEST_PATH,
    default_curriculum_layout_elements_key,
    default_curriculum_provider_response_key,
    default_curriculum_source_pdf_key,
    run_curriculum_course_map_multimodal_probe,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the bounded multimodal probe for curriculum course-map pages.",
    )
    parser.add_argument("--source-bucket")
    parser.add_argument("--split-manifest-path", default=str(DEFAULT_SPLIT_MANIFEST_PATH))
    parser.add_argument("--sample-manifest-path", default=str(DEFAULT_SAMPLE_MANIFEST_PATH))
    parser.add_argument("--gold-manifest-path", default=str(DEFAULT_GOLD_MANIFEST_PATH))
    parser.add_argument("--source-pdf-key", default=default_curriculum_source_pdf_key())
    parser.add_argument(
        "--provider-response-key", default=default_curriculum_provider_response_key()
    )
    parser.add_argument("--layout-elements-key", default=default_curriculum_layout_elements_key())
    parser.add_argument("--pdf-path")
    parser.add_argument("--provider-response-path")
    parser.add_argument("--layout-elements-path")
    parser.add_argument("--output-dir")
    parser.add_argument("--prompt-runs", type=int, default=DEFAULT_PROMPT_RUNS)
    parser.add_argument("--prompt-transport", default=DEFAULT_PROMPT_RUNTIME_TRANSPORT)
    parser.add_argument("--max-inflight-pages", type=int, default=DEFAULT_MAX_INFLIGHT_PAGES)
    parser.add_argument("--max-request-attempts", type=int, default=DEFAULT_MAX_REQUEST_ATTEMPTS)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--repeatability-threshold", type=float, default=DEFAULT_REPEATABILITY_THRESHOLD
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(argv)
    source_bucket = args.source_bucket or ObjectStoreSettings.from_env().bucket_source
    report = run_curriculum_course_map_multimodal_probe(
        source=dict(__import__("os").environ),
        source_bucket=source_bucket,
        split_manifest_path=Path(args.split_manifest_path),
        sample_manifest_path=Path(args.sample_manifest_path),
        gold_manifest_path=Path(args.gold_manifest_path),
        pdf_bytes=Path(args.pdf_path).read_bytes() if args.pdf_path else None,
        provider_response_bytes=(
            Path(args.provider_response_path).read_bytes() if args.provider_response_path else None
        ),
        layout_elements_bytes=Path(args.layout_elements_path).read_bytes()
        if args.layout_elements_path
        else None,
        source_pdf_key=args.source_pdf_key,
        provider_response_key=args.provider_response_key,
        layout_elements_key=args.layout_elements_key,
        output_dir=Path(args.output_dir) if args.output_dir else None,
        prompt_runs=args.prompt_runs,
        repeatability_threshold=args.repeatability_threshold,
        prompt_transport=args.prompt_transport,
        max_inflight_pages=args.max_inflight_pages,
        max_request_attempts=args.max_request_attempts,
        resume=args.resume,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
