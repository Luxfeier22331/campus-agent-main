from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_notice_family import (
    classify_authenticated_notice_bundle_record,
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze authenticated notice bundle notice-family stratification."
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--config-path")
    parser.add_argument("--sample-limit", type=int, default=8)
    parser.add_argument("--output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    source = dict(os.environ)
    config_path = (
        Path(args.config_path)
        if args.config_path
        else read_authenticated_notice_notice_family_config_path(source)
    )
    config = load_authenticated_notice_notice_family_config(config_path)
    bundle_records = load_authenticated_notice_bundle_payload(Path(args.bundle_path))
    report = build_notice_family_report(
        bundle_records=bundle_records,
        config=config,
        sample_limit=args.sample_limit,
        bundle_path=Path(args.bundle_path),
        config_path=config_path,
    )
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output_path:
        Path(args.output_path).write_text(payload, encoding="utf-8")
    print(payload)


def build_notice_family_report(
    *,
    bundle_records: Sequence[dict[str, Any]],
    config,
    sample_limit: int,
    bundle_path: Path,
    config_path: Path,
) -> dict[str, Any]:
    families: dict[str, dict[str, Any]] = {}
    prioritized: list[dict[str, Any]] = []

    for record in bundle_records:
        notice = dict(record.get("notice") or {})
        categories = tuple(dict(item) for item in list(notice.get("categories") or []))
        classification = classify_authenticated_notice_bundle_record(record, config=config)
        family_payload = families.setdefault(
            classification.family,
            {
                "family": classification.family,
                "admission_policy": classification.admission_policy,
                "priority": classification.priority,
                "count": 0,
                "samples": [],
            },
        )
        family_payload["count"] += 1
        if len(family_payload["samples"]) < sample_limit:
            family_payload["samples"].append(
                {
                    "notice_id": str(record.get("notice_id") or ""),
                    "notice_title": str(notice.get("notice_title") or ""),
                    "notice_type_names": [
                        str(item.get("notice_type_name") or "").strip()
                        for item in categories
                        if str(item.get("notice_type_name") or "").strip()
                    ],
                    "matched_title_patterns": list(classification.matched_title_patterns),
                    "matched_body_patterns": list(classification.matched_body_patterns),
                }
            )
        if classification.admission_policy == "priority_now":
            prioritized.append(
                {
                    "notice_id": str(record.get("notice_id") or ""),
                    "notice_title": str(notice.get("notice_title") or ""),
                    "notice_release_time": notice.get("notice_release_time"),
                    "notice_type_names": [
                        str(item.get("notice_type_name") or "").strip()
                        for item in categories
                        if str(item.get("notice_type_name") or "").strip()
                    ],
                    "family": classification.family,
                    "priority": classification.priority,
                    "matched_title_patterns": list(classification.matched_title_patterns),
                    "matched_body_patterns": list(classification.matched_body_patterns),
                }
            )

    ordered_families = sorted(
        families.values(),
        key=lambda item: (-int(item["priority"]), str(item["family"])),
    )
    prioritized.sort(
        key=lambda item: (
            str(item.get("notice_release_time") or ""),
            str(item.get("notice_id") or ""),
        ),
        reverse=True,
    )
    policy_now_count = sum(
        int(item["count"])
        for item in ordered_families
        if str(item["admission_policy"]) == "priority_now"
    )
    return {
        "bundle_path": str(bundle_path),
        "config_path": str(config_path),
        "notice_count": len(tuple(bundle_records)),
        "priority_now_notice_count": policy_now_count,
        "families": ordered_families,
        "priority_now_candidates": prioritized[: max(sample_limit * 3, sample_limit)],
    }


__all__ = ["build_notice_family_report", "build_parser", "main"]


if __name__ == "__main__":
    main()
