from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_SCHEMA_VERSION = "eval_profile_gate.v1"
DEFAULT_REPORT_NAME = "profile-report.json"
DEFAULT_POLICY_ARTIFACT = "eval_operations_profile_policy.v1"


@dataclass(frozen=True, slots=True)
class EvalProfileGateReport:
    profile_id: str
    output_path: Path
    passed: bool


@dataclass(frozen=True, slots=True)
class EvalRuntimeMetrics:
    started_at: str
    finished_at: str
    runtime_seconds: int
    retry_count: int
    provider_calls: int
    collector_version: str
    runtime_profile: str
    metrics_missing: bool = False
