from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ProcessCommandSpec:
    label: str
    command: tuple[str, ...]
    cwd: Path
    env: dict[str, str]
    log_path: Path


@dataclass(frozen=True, slots=True)
class ProcessSmokePlan:
    repo_root: Path
    output_dir: Path
    scenario: str
    api_base_url: str
    execution_run_path: str
    execution_run_payload: dict[str, object]
    expected_run_status: int
    expected_readyz_statuses: tuple[int, ...]
    expected_run_body_tokens: tuple[str, ...]
    processes: tuple[ProcessCommandSpec, ...]
