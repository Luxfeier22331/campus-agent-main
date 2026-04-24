from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_public_docs_generated import (
    public_docs_generated_files,
    validate_public_docs_generated_file,
)


class CheckPublicDocsGeneratedTest(unittest.TestCase):
    def test_public_docs_generated_files_include_markdown_docs_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            included_mdx = root / "apps/public-docs/docs/curriculum-plan/example.mdx"
            included_md = root / "apps/public-docs/docs/student-handbook/example.md"
            excluded_data = root / "apps/public-docs/docs/.generated/course-maps/example.data.ts"
            excluded_readme = root / "apps/public-docs/README.md"
            for path in (included_mdx, included_md, excluded_data, excluded_readme):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("content", encoding="utf-8")

            with patch("scripts.check_public_docs_generated.worktree_paths") as worktree_mock:
                worktree_mock.return_value = (
                    included_mdx,
                    included_md,
                    excluded_data,
                    excluded_readme,
                )

                files = public_docs_generated_files(root=root)

        self.assertEqual(files, (included_mdx, included_md))

    def test_validator_accepts_fidelity_oriented_generated_mdx(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "apps/public-docs/docs/curriculum-plan/example.mdx"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                "\n".join(
                    [
                        "---",
                        'title: "培养方案"',
                        "---",
                        "",
                        "import CourseMapSection from '../.components/CourseMapSection';",
                        "",
                        "<table><tr><td>" + ("复杂表格保真内容" * 40) + "</td></tr></table>",
                    ]
                ),
                encoding="utf-8",
            )

            issues = validate_public_docs_generated_file(path, root=Path(temporary_directory))

        self.assertEqual(issues, ())

    def test_validator_rejects_restricted_collection_and_locator_leaks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "apps/public-docs/docs/student-handbook/leak.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                "\n".join(
                    [
                        "---",
                        "title: 泄漏样例",
                        "---",
                        "",
                        "collection: institutional_rules",
                        "campusrag://promotion/internal_notice/example",
                    ]
                ),
                encoding="utf-8",
            )

            issues = validate_public_docs_generated_file(path, root=Path(temporary_directory))

        messages = [issue.message for issue in issues]
        self.assertIn("contains restricted public-docs marker: institutional_rules", messages)
        self.assertIn("contains internal locator marker: campusrag://", messages)

    def test_validator_rejects_missing_frontmatter_and_conflict_markers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "apps/public-docs/docs/student-handbook/broken.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("<<<<<<< HEAD\n正文\n", encoding="utf-8")

            issues = validate_public_docs_generated_file(path, root=Path(temporary_directory))

        messages = [issue.message for issue in issues]
        self.assertIn("missing frontmatter block", messages)
        self.assertIn("contains git conflict marker: <<<<<<<", messages)


if __name__ == "__main__":
    unittest.main()
