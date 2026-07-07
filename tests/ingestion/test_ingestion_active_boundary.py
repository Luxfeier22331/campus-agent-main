from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

REMOVED_ACTIVE_INGESTION_TASK_KINDS = {
    "alias_publish",
    "canonical_document_materialize",
    "derived_scope_materialize",
    "document_projection_materialize",
    "embedding_index_build",
    "operator_projection_snapshot",
    "provider_" + "extract",
    "raw_asset_ingest",
    "read_model_materialize",
    "source_" + "capture",
    "structured_projection_publish",
}

REMOVED_OFFICIAL_WEB_HANDOFF_TERMS = {
    "APP_API_OFFICIAL_WEB_HANDOFF",
    "OfficialWebHandoff",
    "OfficialWebIngestionHandoff",
    "apps/app-api/src/modules/integration/official-web-handoff",
    "createOfficialWebHandoffPublisher",
    "official_web_fresh_news_handoff.v1",
    "official_web_stable_reference_handoff.v1",
}

REMOVED_ACTIVE_SOURCE_CHANNEL_TERMS = {
    "authenticated_notice_portal",
}

RETIRED_INTERNAL_PORTAL_ACTIVE_TOKENS = {
    "AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE",
    "AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES",
    "AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS",
    "AUTHENTICATED_NOTICE_FILE_RELEASE_TARGET_ID",
    "authenticated_notice_collector_export_v2",
    "authenticated_notice_file_release_export_v1",
    "collectorRunToken",
    "collector_admission",
    "collector_contract_version",
    "collector_run_token",
    "collector_version",
    "latest_collector_run",
    "repo_local_node",
}

RETIRED_INGESTION_TASK_LIFECYCLE_TOKENS = {
    "INGESTION_EXECUTOR_POLL_INTERVAL_MS",
    "INGESTION_EXECUTOR_WORKER_ID",
    "claimNextTask",
    "dead_lettered",
    "executor-runtime",
    "leased_by",
    "runRegistryTaskOnce",
    "start:executor",
    "sweepExpiredLeases",
}

RETIRED_INGESTION_TASK_LIFECYCLE_PATTERNS = {
    "lease_policy": re.compile(r"(?<![A-Za-z0-9_])lease_policy(?![A-Za-z0-9_])"),
    "retry_policy": re.compile(r"(?<![A-Za-z0-9_])retry_policy(?![A-Za-z0-9_])"),
}

RETIRED_INGESTION_TASK_LIFECYCLE_ALLOWLIST = {
    Path("apps/ingestion-control/test/postgres-store.test.ts"),
    Path("tests/ingestion/test_ingestion_active_boundary.py"),
}

RETIRED_INGESTION_TASK_LIFECYCLE_TOKEN_LINE_ALLOWLIST = {
    (
        Path("apps/ingestion-control/src/postgres-store.ts"),
        "dead_lettered",
        "DEVELOP_ERA_TERMINAL_TASK_STATUSES",
    ),
}

INTERNAL_PORTAL_ACTIVE_TOKEN_ROOTS = (
    REPO_ROOT / "apps/source-collector/adapters/internal-portal",
    REPO_ROOT / "apps/ingestion-control",
    REPO_ROOT / "configs/ingestion/authenticated_documents/file_release_source",
    REPO_ROOT / "docs/contracts/authenticated-notice-file-release-export.md",
    REPO_ROOT / "docs/data/authenticated-notice.md",
    REPO_ROOT / "docs/runbooks/notice-release-auth-window.md",
    REPO_ROOT / "tests/ingestion",
)

INTERNAL_PORTAL_ACTIVE_TOKEN_ALLOWLIST = {
    Path("apps/source-collector/adapters/internal-portal/test/config.test.ts"),
    Path("tests/ingestion/test_ingestion_active_boundary.py"),
}

ACTIVE_REFERENCE_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "infra",
    REPO_ROOT / "packages",
    REPO_ROOT / "scripts",
    REPO_ROOT / "tests",
)

REFERENCE_ALLOWLIST = {
    Path("tests/infra/test_ingestion_python_clean_target_residue.py"),
    Path("tests/ingestion/test_ingestion_active_boundary.py"),
}

SOURCE_CHANNEL_RENAME_ALLOWLIST_ROOTS = {
    Path("docs/decisions"),
}

TEXT_SUFFIXES = {
    ".json",
    ".md",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}


class IngestionActiveBoundaryTest(unittest.TestCase):
    def test_ingestion_control_does_not_reintroduce_self_built_executor_runtime(self) -> None:
        removed_paths = [
            Path("apps/ingestion-control/src/executor.ts"),
            Path("apps/ingestion-control/src/executor-runtime.ts"),
            Path("apps/ingestion-control/test/executor.test.ts"),
        ]
        self.assertEqual(
            [str(path) for path in removed_paths if (REPO_ROOT / path).exists()],
            [],
        )

        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if (
                    relative_path in RETIRED_INGESTION_TASK_LIFECYCLE_ALLOWLIST
                    or "archive" in relative_path.parts
                    or relative_path.parts[:2] == ("docs", "decisions")
                ):
                    continue
                text = path.read_text(encoding="utf-8")
                lines = text.splitlines()
                for term in sorted(RETIRED_INGESTION_TASK_LIFECYCLE_TOKENS):
                    for line in lines:
                        if term not in line:
                            continue
                        if (
                            relative_path,
                            term,
                            "DEVELOP_ERA_TERMINAL_TASK_STATUSES",
                        ) in RETIRED_INGESTION_TASK_LIFECYCLE_TOKEN_LINE_ALLOWLIST and (
                            "DEVELOP_ERA_TERMINAL_TASK_STATUSES" in line
                        ):
                            continue
                        offenders.append(f"{relative_path}: {term}")
                for term, pattern in sorted(RETIRED_INGESTION_TASK_LIFECYCLE_PATTERNS.items()):
                    if pattern.search(text):
                        offenders.append(f"{relative_path}: {term}")

        self.assertEqual(offenders, [])

    def test_app_api_uses_shared_ingestion_task_contracts_without_handwritten_dto(
        self,
    ) -> None:
        text = (REPO_ROOT / "apps/app-api/src/modules/integration/ingestion-control.ts").read_text(
            encoding="utf-8"
        )

        self.assertIn('from "ingestion-contracts"', text)
        self.assertNotIn("interface IngestionArtifactRef", text)
        self.assertNotIn("interface IngestionTaskEnvelope", text)

    def test_wechat_collector_no_longer_documents_app_api_as_ingestion_handoff(
        self,
    ) -> None:
        text = (REPO_ROOT / "apps/source-collector/README.md").read_text(encoding="utf-8")

        self.assertNotIn("Optional app-api handoff", text)
        self.assertIn("Optional ingestion-control admission", text)

    def test_authenticated_notice_auth_bootstrap_uses_crawlee_runner_boundary(self) -> None:
        for relative_path in (
            Path("apps/source-collector/adapters/internal-portal/src/auth-save.ts"),
            Path("apps/source-collector/adapters/internal-portal/src/portal.ts"),
        ):
            text = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
            self.assertNotIn("chromium", text, str(relative_path))
            self.assertNotIn("launch(", text, str(relative_path))

        runner_text = (
            REPO_ROOT / "apps/source-collector/adapters/internal-portal/src/auth-crawlee-runner.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("PlaywrightCrawler", runner_text)

    def test_internal_portal_collector_does_not_restore_self_built_backoff_config(self) -> None:
        offenders: list[str] = []
        root = REPO_ROOT / "apps/source-collector/adapters/internal-portal"
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                continue
            relative_path = path.relative_to(REPO_ROOT)
            text = path.read_text(encoding="utf-8")
            for term in ("requestBackoffBaseMs", "INTERNAL_PORTAL_REQUEST_BACKOFF_BASE_MS"):
                if term in text:
                    offenders.append(f"{relative_path}: {term}")

        self.assertEqual(offenders, [])

    def test_active_task_contracts_do_not_admit_unwired_task_kinds(self) -> None:
        contract_files = [
            REPO_ROOT / "packages/ingestion-contracts/src/index.ts",
            REPO_ROOT / "packages/ingestion-contracts/src/campus_ingestion_contracts/__init__.py",
            REPO_ROOT
            / "packages/ingestion-contracts/schemas/ingestion-task-envelope.v2.schema.json",
            REPO_ROOT
            / "packages/ingestion-contracts/schemas/ingestion-task-registry.v2.schema.json",
            REPO_ROOT / "apps/ingestion-control/src/types.ts",
            REPO_ROOT / "apps/ingestion-control/src/postgres-store.ts",
        ]
        offenders: list[str] = []
        for path in contract_files:
            text = path.read_text(encoding="utf-8")
            for task_kind in sorted(REMOVED_ACTIVE_INGESTION_TASK_KINDS):
                if f'"{task_kind}"' in text:
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{task_kind}")

        self.assertEqual(offenders, [])

    def test_active_tree_does_not_reference_official_web_handoff_receiver(self) -> None:
        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if relative_path in REFERENCE_ALLOWLIST or "archive" in relative_path.parts:
                    continue
                text = path.read_text(encoding="utf-8")
                for term in sorted(REMOVED_OFFICIAL_WEB_HANDOFF_TERMS):
                    if term in text:
                        offenders.append(f"{relative_path}: {term}")

        self.assertEqual(offenders, [])

    def test_active_tree_does_not_reference_legacy_worker_modules(self) -> None:
        offenders: list[str] = []
        pattern = re.compile(r"campus_ingestion_worker\.[a-zA-Z0-9_]+")
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if relative_path in REFERENCE_ALLOWLIST or "archive" in relative_path.parts:
                    continue
                text = path.read_text(encoding="utf-8")
                for match in sorted(set(pattern.findall(text))):
                    offenders.append(f"{relative_path}: {match}")

        self.assertEqual(offenders, [])

    def test_active_tree_does_not_reference_retired_authenticated_notice_source_channel(
        self,
    ) -> None:
        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if (
                    relative_path in REFERENCE_ALLOWLIST
                    or "archive" in relative_path.parts
                    or any(
                        relative_path.is_relative_to(allowlist_root)
                        for allowlist_root in SOURCE_CHANNEL_RENAME_ALLOWLIST_ROOTS
                    )
                ):
                    continue
                text = path.read_text(encoding="utf-8")
                for term in sorted(REMOVED_ACTIVE_SOURCE_CHANNEL_TERMS):
                    if term in text:
                        offenders.append(f"{relative_path}: {term}")

        self.assertEqual(offenders, [])

    def test_internal_portal_active_contracts_do_not_reintroduce_retired_names(
        self,
    ) -> None:
        offenders: list[str] = []
        for root in INTERNAL_PORTAL_ACTIVE_TOKEN_ROOTS:
            paths = (root,) if root.is_file() else tuple(root.rglob("*"))
            for path in paths:
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if relative_path in INTERNAL_PORTAL_ACTIVE_TOKEN_ALLOWLIST:
                    continue
                if (
                    relative_path.parts[:2] == ("docs", "decisions")
                    or "archive" in relative_path.parts
                ):
                    continue
                text = path.read_text(encoding="utf-8")
                for term in sorted(RETIRED_INTERNAL_PORTAL_ACTIVE_TOKENS):
                    if term in text:
                        offenders.append(f"{relative_path}: {term}")

        self.assertEqual(offenders, [])

    def test_source_collector_runtime_dirs_are_ignored(self) -> None:
        gitignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")

        self.assertIn("apps/source-collector/adapters/*/runtime/", gitignore)
        self.assertNotIn("apps/authenticated-notice-collector/runtime/", gitignore)

    def test_root_env_example_lists_current_source_collector_templates(self) -> None:
        root_env = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")

        self.assertIn("apps/source-collector/adapters/internal-portal/.env.example", root_env)
        self.assertIn("apps/source-collector/adapters/official-web/.env.example", root_env)
        self.assertIn(
            "apps/source-collector/adapters/wechat-official-account/.env.example",
            root_env,
        )
        self.assertNotIn("apps/authenticated-notice-collector/.env.example", root_env)
        self.assertNotIn("apps/official-web-collector/.env.example", root_env)
        self.assertNotIn("apps/wechat-official-account-collector/.env.example", root_env)
        self.assertNotIn("apps/protected-panel-web/.dev.vars.example", root_env)


if __name__ == "__main__":
    unittest.main()
