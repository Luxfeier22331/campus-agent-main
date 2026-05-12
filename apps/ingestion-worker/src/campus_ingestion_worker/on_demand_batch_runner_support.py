from __future__ import annotations

import argparse
import json
import shutil
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_TIME_PEAK_RSS_MARKER = "__CAMPUS_INGESTION_PEAK_RSS_KB__="
DEFAULT_MAX_BATCH_ITEMS = 200
DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_OCR_INPUT_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_OCR_CACHE_ENTRIES = 1
DEFAULT_MAX_OCR_CACHE_TOTAL_BYTES = 4 * 1024 * 1024
DEFAULT_PEAK_RSS_WARN_KB = 512 * 1024
DEFAULT_PEAK_RSS_HARD_KB = 768 * 1024


@dataclass(frozen=True, slots=True)
class SubprocessResult:
    exit_code: int
    stdout: str
    stderr: str
    peak_rss_kb: int | None = None


def parse_stdout_json(stdout: str) -> Any:
    stripped = stdout.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def wrap_with_time(command: tuple[str, ...]) -> tuple[str, ...]:
    time_binary = shutil.which("time")
    if not time_binary:
        system_time_binary = Path("/usr/bin/time")
        if system_time_binary.exists():
            time_binary = str(system_time_binary)
    if not time_binary:
        return command
    return (
        time_binary,
        "-f",
        f"{_TIME_PEAK_RSS_MARKER}%M",
        *command,
    )


def parse_timed_stderr(stderr: str) -> tuple[str, int | None]:
    peak_rss_kb: int | None = None
    retained_lines: list[str] = []
    for line in stderr.splitlines():
        if line.startswith(_TIME_PEAK_RSS_MARKER):
            raw_value = line.removeprefix(_TIME_PEAK_RSS_MARKER).strip()
            if raw_value:
                peak_rss_kb = int(raw_value)
            continue
        retained_lines.append(line)
    return "\n".join(retained_lines).strip(), peak_rss_kb


def extract_numeric_metrics(payload: Any) -> dict[str, int | float]:
    if not isinstance(payload, dict):
        return {}
    metrics: dict[str, int | float] = {}
    for key, value in payload.items():
        if isinstance(value, bool):
            continue
        if isinstance(value, int | float):
            metrics[key] = value
    return metrics


def tail(value: str, *, max_chars: int = 4000) -> str:
    stripped = value.strip()
    if len(stripped) <= max_chars:
        return stripped
    return stripped[-max_chars:]


def first_failed_step_name(steps: Sequence[dict[str, Any]]) -> str | None:
    for step in steps:
        if step["status"] != "succeeded":
            return str(step["name"])
    return None


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def non_negative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be a non-negative integer")
    return parsed


def add_common_runtime_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--report-path",
        help="Optional path for the full on-demand batch JSON report.",
    )
    parser.add_argument("--max-batch-items", type=positive_int)
    parser.add_argument("--max-attachment-bytes", type=positive_int)
    parser.add_argument("--max-ocr-input-bytes", type=positive_int)
    parser.add_argument("--max-ocr-cache-entries", type=non_negative_int)
    parser.add_argument("--max-ocr-cache-total-bytes", type=non_negative_int)
    parser.add_argument("--peak-rss-warn-kb", type=positive_int)
    parser.add_argument("--peak-rss-hard-kb", type=positive_int)


def write_report(*, report: dict[str, Any], output_path: str | None) -> None:
    if not output_path:
        return
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )


def env_int(env: dict[str, str], key: str, default: int) -> int:
    raw = str(env.get(key) or "").strip()
    if not raw:
        return default
    parsed = int(raw)
    if parsed < 0:
        raise ValueError(f"{key} must be non-negative")
    return parsed


def require_within_batch_limit(*, name: str, value: int, policy: Any) -> None:
    if value > policy.max_batch_items:
        raise ValueError(
            f"{name}={value} exceeds INGESTION_ON_DEMAND_MAX_BATCH_ITEMS={policy.max_batch_items}"
        )


def classify_rss_budget(*, peak_rss_kb: int, policy: Any) -> str:
    if peak_rss_kb >= policy.peak_rss_hard_kb:
        return "hard_exceeded"
    if peak_rss_kb >= policy.peak_rss_warn_kb:
        return "warn_exceeded"
    return "within_budget"


__all__ = [
    "DEFAULT_MAX_ATTACHMENT_BYTES",
    "DEFAULT_MAX_BATCH_ITEMS",
    "DEFAULT_MAX_OCR_CACHE_ENTRIES",
    "DEFAULT_MAX_OCR_CACHE_TOTAL_BYTES",
    "DEFAULT_MAX_OCR_INPUT_BYTES",
    "DEFAULT_PEAK_RSS_HARD_KB",
    "DEFAULT_PEAK_RSS_WARN_KB",
    "SubprocessResult",
    "add_common_runtime_args",
    "classify_rss_budget",
    "env_int",
    "extract_numeric_metrics",
    "first_failed_step_name",
    "parse_stdout_json",
    "parse_timed_stderr",
    "require_within_batch_limit",
    "tail",
    "wrap_with_time",
    "write_report",
]
