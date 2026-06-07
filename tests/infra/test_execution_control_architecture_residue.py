from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

HISTORICAL_PATH_PARTS = (
    "/.planning/legacy-flat/",
    "/.planning/quick/",
    "/.planning/research/",
    "/infra/local/staging/historical/",
    "durable-agent-runtime-gap-matrix.md",
    "adr-0047-run-centric-durable-agent-runtime.md",
)

RETIRED_BUILD_TAG = "//go:build retired_pg_lease"

ACTIVE_TRUTH_PREFIXES = (
    "/.github/",
    "/.planning/",
    "/AGENTS.md",
    "/docs/",
    "/env/",
    "/infra/",
    "/packages/",
)

ACTIVE_RUNTIME_PREFIXES = (
    "/.dockerignore",
    "/.env.example",
    "/.env.staging.local.example",
    "/.github/",
    "/apps/",
    "/configs/",
    "/docs/",
    "/env/",
    "/infra/",
    "/packages/",
    "/scripts/",
)

ACTIVE_PLANNING_ENTRY_PREFIXES = (
    "/.planning/PROJECT.md",
    "/.planning/WORKSTREAMS.md",
    "/.planning/codebase/",
)

ACTIVE_FORBIDDEN_TERMS = (
    "execution-gateway",
    "service-gateway",
    "service-control",
    "EXECUTION_GATEWAY",
    "EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN",
    "TUNNEL_TOKEN",
    "exec-staging",
    "campusRAG",
)

ACTIVE_SUPERVISOR_API_ALLOWED_PATH_PARTS = (
    "/.planning/legacy-flat/",
    "/.planning/quick/",
    "/.planning/research/",
    "/.planning/workstreams/",
)

ACTIVE_SUPERVISOR_API_FORBIDDEN_TERMS = (
    "apps/supervisor-api",
    "supervisor-api",
)

ONLINE_LEASE_FORBIDDEN_PATTERNS = (
    "NewDurableLeaseCoordinator",
    "DurableLeaseCoordinator",
    "runtime.execution_leases",
)

ONLINE_LEASE_ALLOWED_PATH_PARTS = (
    "/tests/infra/test_execution_control_architecture_residue.py",
    "/apps/execution-control/internal/execution/run_projection_postgres_store_test.go",
)

LEGACY_ANSWER_ROUTE_FORBIDDEN_PATTERNS = (
    "/api/v1/answer",
    "/api/v1/answer/stream",
    "ANSWER_ROUTE",
)

LEGACY_ANSWER_ROUTE_ALLOWED_PATH_PARTS = (
    "/tests/infra/test_execution_control_architecture_residue.py",
    "/tests/test_supervisor_api_local_runtime.py",
    "/apps/execution-control/internal/httpapi/durable_legacy_routes_test.go",
    "/docs/contracts/app-api-request-lifecycle.md",
    "/docs/contracts/app-api-supervisor-execution.md",
    "/docs/contracts/durable-agent-runtime-contract.md",
    "/docs/reference/durable-agent-runtime-gap-matrix.md",
    "/docs/runbooks/execution-control-local-runtime-smoke.md",
)

READYZ_FORBIDDEN_PATTERNS = (
    "workflow_run_runtime",
)

READYZ_ALLOWED_PATH_PARTS = (
    "/tests/infra/test_execution_control_architecture_residue.py",
    "/apps/execution-control/internal/httpapi/durable_runtime_store_wiring_test.go",
)


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        check=True,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return [
        path
        for raw in result.stdout.split(b"\0")
        if raw
        for path in [ROOT / raw.decode("utf-8", errors="surrogateescape")]
        if path.is_file()
    ]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def normalized_relative(path: Path) -> str:
    return "/" + path.relative_to(ROOT).as_posix()


def is_historical(path: Path) -> bool:
    relative = normalized_relative(path)
    return any(part in relative for part in HISTORICAL_PATH_PARTS)


def has_retired_pg_lease_build_tag(path: Path) -> bool:
    if path.suffix != ".go":
        return False
    return RETIRED_BUILD_TAG in read_text(path).splitlines()[:5]


def is_under(path: Path, prefixes: tuple[str, ...]) -> bool:
    relative = normalized_relative(path)
    return any(relative.startswith(prefix) for prefix in prefixes)


class ExecutionControlArchitectureResidueTest(unittest.TestCase):
    maxDiff = None

    def test_active_truth_does_not_reintroduce_gateway_service_or_tunnel_terms(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            if is_historical(path) or not is_under(
                path,
                ACTIVE_TRUTH_PREFIXES + ACTIVE_RUNTIME_PREFIXES,
            ):
                continue
            text = read_text(path)
            for term in ACTIVE_FORBIDDEN_TERMS:
                if term in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {term}")

        self.assertEqual(offenders, [])

    def test_active_truth_does_not_use_supervisor_api_as_runtime_app_name(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if not is_under(
                path,
                ACTIVE_RUNTIME_PREFIXES + ACTIVE_PLANNING_ENTRY_PREFIXES,
            ):
                continue
            if any(part in relative for part in ACTIVE_SUPERVISOR_API_ALLOWED_PATH_PARTS):
                continue
            text = read_text(path)
            for line_number, line in enumerate(text.splitlines(), start=1):
                if relative == "/.planning/WORKSTREAMS.md" and "historical name" in line:
                    continue
                for term in ACTIVE_SUPERVISOR_API_FORBIDDEN_TERMS:
                    if term in line:
                        offenders.append(
                            f"{path.relative_to(ROOT)}:{line_number} contains {term}",
                        )

        self.assertEqual(offenders, [])

    def test_pg_lease_artifacts_are_not_referenced_by_online_serving_paths(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if not is_under(path, ACTIVE_RUNTIME_PREFIXES):
                continue
            if has_retired_pg_lease_build_tag(path):
                continue
            if any(part in relative for part in ONLINE_LEASE_ALLOWED_PATH_PARTS):
                continue
            text = read_text(path)
            for pattern in ONLINE_LEASE_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])

    def test_legacy_answer_routes_are_not_active_serving_truth(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if is_historical(path) or has_retired_pg_lease_build_tag(path):
                continue
            if any(part in relative for part in LEGACY_ANSWER_ROUTE_ALLOWED_PATH_PARTS):
                continue
            if not is_under(
                path,
                ACTIVE_RUNTIME_PREFIXES + ACTIVE_PLANNING_ENTRY_PREFIXES,
            ):
                continue
            text = read_text(path)
            for pattern in LEGACY_ANSWER_ROUTE_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])

    def test_readyz_does_not_publish_retired_workflow_run_runtime(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if is_historical(path) or has_retired_pg_lease_build_tag(path):
                continue
            if any(part in relative for part in READYZ_ALLOWED_PATH_PARTS):
                continue
            if not is_under(path, ACTIVE_RUNTIME_PREFIXES + ACTIVE_PLANNING_ENTRY_PREFIXES):
                continue
            text = read_text(path)
            for pattern in READYZ_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
