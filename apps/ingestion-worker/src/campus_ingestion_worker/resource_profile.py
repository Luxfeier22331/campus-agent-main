from __future__ import annotations

import resource
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

INGESTION_RESOURCE_PROFILE_SCHEMA_VERSION = "campus_ingestion_resource_profile.v1"


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def monotonic_seconds() -> float:
    return time.perf_counter()


def current_process_peak_rss_kb() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def child_process_peak_rss_kb() -> int:
    return int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)


def child_process_peak_rss_delta_kb(before_peak_rss_kb: int) -> int:
    return max(0, child_process_peak_rss_kb() - int(before_peak_rss_kb))


def build_resource_profile(
    *,
    command: tuple[str, ...],
    status: str,
    exit_code: int,
    started_at: str,
    finished_at: str,
    elapsed_seconds: float,
    peak_rss_kb: int,
    metrics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": INGESTION_RESOURCE_PROFILE_SCHEMA_VERSION,
        "command": list(command),
        "status": status,
        "exit_code": int(exit_code),
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_seconds": round(float(elapsed_seconds), 6),
        "peak_rss_kb": int(peak_rss_kb),
        "metrics": dict(metrics or {}),
    }


__all__ = [
    "INGESTION_RESOURCE_PROFILE_SCHEMA_VERSION",
    "build_resource_profile",
    "child_process_peak_rss_delta_kb",
    "child_process_peak_rss_kb",
    "current_process_peak_rss_kb",
    "monotonic_seconds",
    "utc_now_iso",
]
