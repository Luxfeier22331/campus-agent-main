from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_markdown_tracked import main, tracked_markdown_files


class CheckMarkdownTrackedTest(unittest.TestCase):
    def test_markdownlint_config_only_keeps_repo_specific_html_allowlist(self) -> None:
        config = json.loads(
            (Path(__file__).resolve().parents[1] / ".markdownlint-cli2.jsonc").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(
            config,
            {
                "config": {
                    "MD033": {
                        "allowed_elements": [
                            "role",
                            "invariants",
                            "task",
                            "output_contract",
                            "CourseMapSection",
                        ]
                    }
                }
            },
        )

    def test_tracked_markdown_files_match_repo_live_surface_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            [
                "git",
                "-c",
                "core.quotePath=false",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "README.md",
                "AGENTS.md",
                "CONTRIBUTING.md",
                ".github/pull_request_template.md",
                "docs",
                "apps",
                "packages",
                "configs",
                "infra",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            path
            for item in expected.stdout.split(b"\0")
            if item
            for decoded in [item.decode("utf-8")]
            for path in [repo_root / decoded]
            if _is_tracked_markdown_candidate(decoded) and path.exists()
        )

        self.assertEqual(tracked_markdown_files(root=repo_root), expected_paths)

    def test_tracked_markdown_files_exclude_planning_vendor_and_archives(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        files = tracked_markdown_files(root=repo_root)
        relative_paths = {str(path.relative_to(repo_root)) for path in files}

        self.assertIn("apps/app-api/README.md", relative_paths)
        self.assertIn("apps/public-docs/README.md", relative_paths)
        self.assertIn("infra/otel/README.md", relative_paths)
        self.assertNotIn("apps/public-docs/docs/index.md", relative_paths)
        self.assertNotIn(
            "apps/public-docs/docs/curriculum-plan/special-programs/computer-science-ethnic-experimental-program.mdx",
            relative_paths,
        )
        self.assertIn("packages/rag-agent/AGENTS.md", relative_paths)
        self.assertNotIn(".planning/PROJECT.md", relative_paths)
        self.assertNotIn("apps/public-chat-web/vendor/vercel-ai-chatbot/README.md", relative_paths)

    @patch("scripts.check_markdown_tracked.subprocess.run")
    def test_main_invokes_markdownlint_with_tracked_files(
        self,
        run_mock: subprocess.CompletedProcess[str],
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_markdown_tracked.tracked_markdown_files",
            return_value=(
                repo_root / "README.md",
                repo_root / "docs/reference/testing-and-verification-lanes.md",
                repo_root / "apps/public-docs/README.md",
            ),
        ):
            run_mock.return_value = subprocess.CompletedProcess(
                args=["markdownlint-cli2"], returncode=0
            )

            exit_code = main()

        self.assertEqual(exit_code, 0)
        args = run_mock.call_args.args[0]
        self.assertEqual(
            args,
            [
                "pnpm",
                "exec",
                "markdownlint-cli2",
                "--config",
                ".markdownlint-cli2.jsonc",
                "README.md",
                "docs/reference/testing-and-verification-lanes.md",
                "apps/public-docs/README.md",
            ],
        )

    @patch("scripts.worktree_file_discovery.subprocess.run")
    def test_tracked_markdown_files_skip_missing_tracked_paths(
        self, run_mock: subprocess.CompletedProcess[bytes]
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        run_mock.return_value = subprocess.CompletedProcess(
            args=["git"],
            returncode=0,
            stdout=(
                b"README.md\0"
                b"apps/public-docs/docs/.missing/computer-science-ethnic-experimental-program.mdx\0"
            ),
        )

        files = tracked_markdown_files(root=repo_root)

        self.assertEqual(files, (repo_root / "README.md",))


def _is_tracked_markdown_candidate(path: str) -> bool:
    if path.startswith(".planning/"):
        return False
    if "/vendor/" in path or "/node_modules/" in path:
        return False
    if path.startswith("docs/"):
        if "/archive/" in path:
            return False
        return path.endswith(".md")
    if path in {"README.md", "AGENTS.md", "CONTRIBUTING.md", ".github/pull_request_template.md"}:
        return True
    if path.startswith("apps/public-docs/docs/"):
        return False
    if path.startswith(("apps/", "packages/", "configs/", "infra/")):
        return path.endswith(".md")
    return False
