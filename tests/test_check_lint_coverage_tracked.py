from __future__ import annotations

import unittest
from pathlib import Path

from scripts.check_lint_coverage_tracked import (
    audit_lint_coverage,
    lint_exclusion_reason,
    lint_families_for_path,
    tracked_lint_candidate_paths,
)


class CheckLintCoverageTrackedTest(unittest.TestCase):
    def test_tracked_lint_candidate_paths_include_live_surface_examples(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        candidates = set(tracked_lint_candidate_paths(root=repo_root))

        self.assertIn("package.json", candidates)
        self.assertIn("apps/public-chat-web/index.html", candidates)
        self.assertIn(
            "apps/public-docs/docs/curriculum-plan/computer-science-ethnic-experimental-program.mdx",
            candidates,
        )
        self.assertIn(
            "apps/legacy-office-conversion-service/src/main/java/com/campusagent/legacyoffice/LegacyOfficeConversionService.java",
            candidates,
        )

    def test_lint_families_map_known_paths_to_expected_lanes(self) -> None:
        self.assertEqual(lint_families_for_path("package.json"), ("web:lint",))
        self.assertEqual(
            lint_families_for_path(
                "apps/legacy-office-conversion-service/src/main/java/com/campusagent/legacyoffice/LegacyOfficeConversionService.java"
            ),
            ("java:lint",),
        )
        self.assertEqual(
            lint_families_for_path("apps/public-chat-web/index.html"),
            ("html:lint",),
        )
        self.assertEqual(
            lint_families_for_path(
                "apps/public-docs/docs/curriculum-plan/computer-science-ethnic-experimental-program.mdx"
            ),
            ("docs:lint",),
        )
        self.assertEqual(
            lint_families_for_path("tests/test_check_xml_tracked.py"),
            ("py:lint", "py:format:check"),
        )
        self.assertEqual(
            lint_families_for_path(".github/workflows/lint.yml"),
            ("yaml:lint",),
        )
        self.assertEqual(
            lint_families_for_path(".editorconfig"),
            ("editorconfig:lint",),
        )
        self.assertEqual(
            lint_families_for_path(".sqlfluff"),
            ("sql:lint",),
        )

    def test_lint_exclusion_reason_covers_known_deferred_surfaces(self) -> None:
        self.assertEqual(lint_exclusion_reason(".planning/PROJECT.md"), "planning_artifact")
        self.assertEqual(
            lint_exclusion_reason("apps/public-chat-web/vendor/vercel-ai-chatbot/package.json"),
            "vendor_snapshot",
        )
        self.assertEqual(
            lint_exclusion_reason(
                "apps/public-docs/docs/.generated/course-maps/law-ethnic-experimental-program.data.ts"
            ),
            "generated_public_docs_course_map_data",
        )
        self.assertIsNone(lint_exclusion_reason("apps/public-docs/docs/index.md"))
        self.assertIsNone(
            lint_exclusion_reason(
                "apps/legacy-office-conversion-service/src/main/java/com/campusagent/legacyoffice/LegacyOfficeConversionService.java"
            )
        )
        self.assertEqual(
            lint_exclusion_reason(
                "apps/public-docs/docs/public/course-maps/law-ethnic-experimental-program/map-01.png"
            ),
            "binary_asset",
        )

    def test_repo_inventory_has_no_uncovered_tracked_lint_candidates(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        self.assertEqual(audit_lint_coverage(root=repo_root), ())

    def test_tracked_lint_candidate_paths_skip_missing_tracked_files(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        with unittest.mock.patch("scripts.check_lint_coverage_tracked.subprocess.run") as run_mock:
            run_mock.return_value = unittest.mock.Mock(
                stdout=(
                    b"package.json\0"
                    b"apps/public-docs/docs/.missing/computer-science-ethnic-experimental-program.mdx\0"
                )
            )

            candidates = tracked_lint_candidate_paths(root=repo_root)

        self.assertEqual(candidates, ("package.json",))
