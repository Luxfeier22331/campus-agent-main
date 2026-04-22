from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_markdown_tracked import main, tracked_markdown_files


class CheckMarkdownTrackedTest(unittest.TestCase):
    def test_tracked_markdown_files_match_repo_live_surface_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            [
                "git",
                "-c",
                "core.quotePath=false",
                "ls-files",
                "-z",
                "README.md",
                "AGENTS.md",
                "CONTRIBUTING.md",
                ".github/pull_request_template.md",
                "docs",
                "apps",
                "packages",
                "configs",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item and _is_tracked_markdown_candidate(decoded := item.decode("utf-8"))
        )

        self.assertEqual(tracked_markdown_files(root=repo_root), expected_paths)

    def test_tracked_markdown_files_exclude_planning_vendor_and_archives(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        files = tracked_markdown_files(root=repo_root)
        relative_paths = {str(path.relative_to(repo_root)) for path in files}

        self.assertIn("apps/app-api/README.md", relative_paths)
        self.assertIn(
            "apps/public-docs-rspress/docs/curriculum-plan/computer-science-ethnic-experimental-program.mdx",
            relative_paths,
        )
        self.assertIn("packages/rag-agent/AGENTS.md", relative_paths)
        self.assertNotIn(".planning/PROJECT.md", relative_paths)
        self.assertNotIn("apps/public-chat-web/vendor/vercel-ai-chatbot/README.md", relative_paths)
        self.assertNotIn("docs/plans/example.md", relative_paths)

    @patch("scripts.check_markdown_tracked.subprocess.run")
    def test_main_invokes_markdownlint_with_tracked_files(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        run_mock.side_effect = [
            subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout=(
                    "README.md\0"
                    "docs/reference/testing-and-verification-lanes.md\0"
                    "apps/public-docs-rspress/docs/curriculum-plan/computer-science-ethnic-experimental-program.mdx\0"
                    "apps/public-chat-web/vendor/vercel-ai-chatbot/README.md\0"
                ).encode("utf-8"),
            ),
            subprocess.CompletedProcess(args=["markdownlint-cli2"], returncode=0),
        ]

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
                "apps/public-docs-rspress/docs/curriculum-plan/computer-science-ethnic-experimental-program.mdx",
            ],
        )


def _is_tracked_markdown_candidate(path: str) -> bool:
    if path.startswith(".planning/"):
        return False
    if "/vendor/" in path or "/node_modules/" in path:
        return False
    if path.startswith("docs/"):
        if "/archive/" in path or path.startswith("docs/plans/"):
            return False
        return path.endswith(".md")
    if path in {"README.md", "AGENTS.md", "CONTRIBUTING.md", ".github/pull_request_template.md"}:
        return True
    if path.startswith(("apps/", "packages/", "configs/")):
        if path.endswith(".md"):
            return True
        return path.startswith("apps/public-docs-rspress/docs/") and path.endswith(".mdx")
    return False
