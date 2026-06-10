from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

HISTORICAL_PATH_PARTS = (
    "/infra/local/staging/historical/",
    "adr-0047-run-centric-durable-agent-runtime.md",
)

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

REMOVED_PLANNING_TREE_PATTERNS = (
    ".planning/workstreams",
    ".planning/quick",
    ".planning/legacy-flat",
    ".planning/milestones",
    ".planning/research",
    ".planning/todos",
    ".planning/codebase",
    ".planning/seeds",
    "docs/plans",
)

REMOVED_PLANNING_TREE_ALLOWED_PATH_PARTS = (
    "/.planning/PROJECT.md",
    "/.planning/WORKSTREAMS.md",
    "/docs/README.md",
    "/docs/decisions/adr-0038-documentation-information-architecture-and-lifecycle.md",
    "/tests/infra/test_execution_control_architecture_residue.py",
    "/tests/test_check_markdown_tracked.py",
)

ACTIVE_SUPERVISOR_API_ALLOWED_PATH_PARTS = (
    "/docs/decisions/adr-0047-run-centric-durable-agent-runtime.md",
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
    "/docs/decisions/adr-0047-run-centric-durable-agent-runtime.md",
)

LEGACY_ANSWER_ROUTE_FORBIDDEN_PATTERNS = (
    "/api/v1/answer",
    "/api/v1/answer/stream",
    "ANSWER_ROUTE",
)

LEGACY_ANSWER_ROUTE_ALLOWED_PATH_PARTS = (
    "/tests/infra/test_execution_control_architecture_residue.py",
)

READYZ_FORBIDDEN_PATTERNS = (
    "workflow_run_runtime",
)

READYZ_ALLOWED_PATH_PARTS = (
    "/tests/infra/test_execution_control_architecture_residue.py",
    "/apps/execution-control/internal/httpapi/run_projection_store_wiring_test.go",
)

ONLINE_PYTHON_BRIDGE_FORBIDDEN_PATTERNS = (
    'env:"SUPERVISOR_AGENT_WORKER_',
    'env:"EXECUTION_CONTROL_BRIDGE_',
    'resolved.set("SUPERVISOR_AGENT_WORKER_',
    'export SUPERVISOR_AGENT_WORKER_',
    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET is missing",
    "supervisor-agent-worker:27052",
    "execution_control_staging_bridge_shared_secret",
    'exec -T supervisor-agent-worker',
    "logs --no-color supervisor-agent-worker",
    "bridge_runtime",
)

ONLINE_PYTHON_BRIDGE_PATHS = (
    "/apps/execution-control/cmd/",
    "/apps/execution-control/internal/config/",
    "/apps/execution-control/internal/httpapi/server.go",
    "/infra/local/docker-compose.execution-control-runtime.yml",
    "/infra/local/start-execution-control-runtime.sh",
    "/infra/local/smoke-execution-control-runtime.sh",
    "/infra/local/staging/",
)

TEMPORAL_RAG_GRAPH_FORBIDDEN_PATTERNS = (
    '"semantic.rag"',
    "InvokeSemanticWorker",
    "FinalizeChatAnswer",
)

TEMPORAL_RAG_GRAPH_PATHS = (
    "/apps/execution-control/internal/temporalruntime/",
    "/apps/execution-control/internal/httpapi/temporal_activity.go",
    "/apps/execution-control/internal/httpapi/temporal_activity_projection.go",
    "/apps/execution-control/internal/httpapi/temporal_memory_projection.go",
    "/apps/execution-control/internal/httpapi/temporal_rag_projection.go",
    "/apps/execution-control/internal/httpapi/personal_memory_recall.go",
    "/apps/execution-control/internal/httpapi/rag_synthesis.go",
)

OLD_CANCEL_ROUTE_FORBIDDEN_PATTERNS = (
    'path == "/internal/execution/cancel"',
    "handleCancel(writer, request)",
    "propagateBridgeCancel",
)

OLD_CANCEL_ROUTE_PATHS = (
    "/apps/execution-control/internal/httpapi/server.go",
    "/apps/execution-control/internal/httpapi/cancel_handler.go",
)

ACTIVE_EXECUTION_TRUTH_DOC_PATHS = (
    "/AGENTS.md",
    "/README.md",
    "/.planning/PROJECT.md",
    "/docs/architecture/current-architecture.md",
    "/docs/architecture/system/durable-agent-runtime-architecture.md",
    "/docs/architecture/system/execution-and-agents-architecture.md",
    "/docs/architecture/system/product-runtime-architecture.md",
    "/docs/architecture/system/python-capability-boundaries.md",
    "/docs/decisions/adr-0048-temporal-execution-plane.md",
    "/docs/runbooks/execution-control-staging-operations.md",
    "/docs/runbooks/execution-control-staging-smoke-runbook.md",
    "/docs/runbooks/execution-control-local-runtime-smoke.md",
    "/apps/execution-control/README.md",
)

ACTIVE_EXECUTION_TRUTH_FORBIDDEN_SNIPPETS = (
    "current private semantic bridge",
    "当前 private semantic bridge",
    "当前 online answer path 仍",
    "当前在线 RAG 路径仍",
    "当前在线回答主路径是 `app-api -> execution-control -> Temporal -> activity worker\n  -> supervisor-agent-worker",
    "supervisor-agent-worker + Temporal workers",
    "execution-control + supervisor-agent-worker",
    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=<bridge secret>",
    "SUPERVISOR_AGENT_WORKER_TIMEOUT_MS=35000",
    "bridge_runtime.reachable",
    "bridge_runtime.circuit_state",
    "POST /internal/execution/cancel",
    "planning`、`semantic.rag`",
    "planning -> semantic.rag",
    "当前 Agents SDK 路径固定为 SDK-native worker runtime",
    "当前 Python worker 只保留一条 structured domain-agent substrate",
    "SDK runtime 默认开启",
    "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED=false",
    "在公开 answer / stream 入口同样走 `single_step` bridge lane",
)

DETERMINISTIC_AGENT_LABEL_FORBIDDEN_PATTERNS = (
    "campus-services-agent",
    "notice-agent",
    "navigation-agent",
    "rag-agent",
    "campus_services_agent",
    "campus_notice_agent",
    "campus_navigation_agent",
    "campus_rag_agent",
    "delegate_to_rag_agent",
    "delegate_to_navigation_agent",
    "delegate_to_notice_agent",
    "rag_agent_",
    "notice_agent",
    "navigation_agent",
    "agent_dispatch",
    "agent_delegates",
    "AgentDispatcher",
    "MissingAgentDelegateError",
    "RagAgent",
    "RAG agent",
    "retrieval agent",
    "agent-handoff",
    "agent handoff",
    "agent contract",
    "supervisor -> agent",
    "AgentInvocation",
    "allowed agents",
    "owner agent",
)

DETERMINISTIC_AGENT_LABEL_ALLOWED_PATH_PARTS = (
    "/tests/infra/test_execution_control_architecture_residue.py",
)

DETERMINISTIC_AGENT_FIELD_FORBIDDEN_PATTERNS = (
    "owner_agent",
    "AgentSpec",
    "allowed_agents",
    "agent_id",
    "selected_target",
    "selected target",
    "selected_target_label",
    "agent_spec_admission_failed",
)

DETERMINISTIC_AGENT_FIELD_ALLOWED_PATH_PARTS = (
    "/apps/app-api/drizzle/",
    "/tests/infra/test_execution_control_architecture_residue.py",
)

KNOWLEDGE_CAPABILITY_SOURCE_PREFIX = (
    "/packages/knowledge-capability/src/campus_knowledge_capability/",
)

KNOWLEDGE_CAPABILITY_FORBIDDEN_FILENAME_PREFIXES = (
    "agent.py",
    "agent_",
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

    def test_removed_planning_archive_trees_are_not_referenced_as_active_truth(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if any(part in relative for part in REMOVED_PLANNING_TREE_ALLOWED_PATH_PARTS):
                continue
            if is_historical(path):
                continue
            if not is_under(path, ACTIVE_TRUTH_PREFIXES + ACTIVE_RUNTIME_PREFIXES + ("/tests/",)):
                continue
            text = read_text(path)
            for pattern in REMOVED_PLANNING_TREE_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

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
            if not is_under(path, (*ACTIVE_RUNTIME_PREFIXES, "/tests/")):
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
            if is_historical(path):
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
            if is_historical(path):
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

    def test_online_execution_lifecycle_does_not_require_python_bridge(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if not any(relative.startswith(prefix) for prefix in ONLINE_PYTHON_BRIDGE_PATHS):
                continue
            text = read_text(path)
            for pattern in ONLINE_PYTHON_BRIDGE_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])

    def test_temporal_rag_graph_does_not_use_retired_semantic_rag_activity(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if not any(relative.startswith(prefix) for prefix in TEMPORAL_RAG_GRAPH_PATHS):
                continue
            text = read_text(path)
            for pattern in TEMPORAL_RAG_GRAPH_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])

    def test_old_bridge_cancel_route_is_not_online_serving_path(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if not any(relative.startswith(prefix) for prefix in OLD_CANCEL_ROUTE_PATHS):
                continue
            text = read_text(path)
            for pattern in OLD_CANCEL_ROUTE_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])

    def test_active_execution_truth_docs_do_not_restore_python_bridge_path(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if relative not in ACTIVE_EXECUTION_TRUTH_DOC_PATHS:
                continue
            text = read_text(path)
            for snippet in ACTIVE_EXECUTION_TRUTH_FORBIDDEN_SNIPPETS:
                if snippet in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {snippet}")

        self.assertEqual(offenders, [])

    def test_deterministic_capabilities_do_not_use_agent_runtime_labels(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if is_historical(path):
                continue
            if any(part in relative for part in DETERMINISTIC_AGENT_LABEL_ALLOWED_PATH_PARTS):
                continue
            if not is_under(path, ACTIVE_TRUTH_PREFIXES + ACTIVE_RUNTIME_PREFIXES):
                continue
            text = read_text(path)
            for pattern in DETERMINISTIC_AGENT_LABEL_FORBIDDEN_PATTERNS:
                if pattern in text:
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])

    def test_knowledge_capability_source_uses_capability_runtime_names(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if not any(relative.startswith(prefix) for prefix in KNOWLEDGE_CAPABILITY_SOURCE_PREFIX):
                continue
            if any(
                path.name == prefix or path.name.startswith(prefix)
                for prefix in KNOWLEDGE_CAPABILITY_FORBIDDEN_FILENAME_PREFIXES
            ):
                offenders.append(f"{path.relative_to(ROOT)} uses retired agent module name")

        self.assertEqual(offenders, [])

    def test_active_contracts_use_capability_tool_fields_not_agent_fields(self) -> None:
        offenders: list[str] = []

        for path in tracked_files():
            relative = normalized_relative(path)
            if is_historical(path):
                continue
            if any(part in relative for part in DETERMINISTIC_AGENT_FIELD_ALLOWED_PATH_PARTS):
                continue
            if not is_under(path, ACTIVE_RUNTIME_PREFIXES):
                continue
            text = read_text(path)
            for pattern in DETERMINISTIC_AGENT_FIELD_FORBIDDEN_PATTERNS:
                token_pattern = rf"(?<![A-Za-z0-9_]){re.escape(pattern)}(?![A-Za-z0-9_])"
                if re.search(token_pattern, text):
                    offenders.append(f"{path.relative_to(ROOT)} contains {pattern}")

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
