from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

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
        self.assertIn("apps/campus-web/index.html", candidates)
        self.assertIn("apps/app-api/README.md", candidates)
        self.assertIn("apps/official-web-collector/README.md", candidates)
        self.assertIn("jobs/dining-sync/src/config.ts", candidates)
        self.assertIn(
            "apps/legacy-office-conversion-service/src/main/java/com/campusagent/legacyoffice/LegacyOfficeConversionService.java",
            candidates,
        )
        self.assertIn("apps/execution-control/internal/execution/request.go", candidates)

    def test_lint_families_map_known_paths_to_expected_lanes(self) -> None:
        self.assertEqual(lint_families_for_path("package.json"), ("web:lint",))
        self.assertEqual(
            lint_families_for_path(
                "apps/legacy-office-conversion-service/src/main/java/com/campusagent/legacyoffice/LegacyOfficeConversionService.java"
            ),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("apps/campus-web/index.html"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("infra/local/scripts/ensure-runtime-secrets.mjs"),
            ("web:lint",),
        )
        self.assertEqual(
            lint_families_for_path("jobs/dining-sync/src/config.ts"),
            ("web:lint",),
        )
        self.assertEqual(
            lint_families_for_path("apps/app-api/README.md"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("apps/official-web-collector/README.md"),
            ("repo:static",),
        )
        self.assertEqual(lint_families_for_path("SECURITY.md"), ("repo:static",))
        self.assertEqual(lint_families_for_path("SUPPORT.md"), ("repo:static",))
        self.assertEqual(lint_families_for_path("CODE_OF_CONDUCT.md"), ("repo:static",))
        self.assertEqual(
            lint_families_for_path(".github/ISSUE_TEMPLATE/bug_report.md"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("tests/test_check_xml_tracked.py"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("scripts/check_public_asset_source_clean.py"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("scripts/check_public_source_tokens.py"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("scripts/check_open_source_metadata.py"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("scripts/check_dependency_license_policy.py"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("scripts/check_object_store_bucket_policy.py"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path("apps/execution-control/internal/execution/request.go"),
            ("ci:go",),
        )
        self.assertEqual(
            lint_families_for_path(".github/workflows/lint.yml"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path(".editorconfig"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path(".sqlfluff"),
            ("repo:static",),
        )
        self.assertEqual(
            lint_families_for_path(
                "infra/local/staging/install-execution-control-staging-task.ps1"
            ),
            (),
        )

    def test_lint_exclusion_reason_covers_known_deferred_surfaces(self) -> None:
        self.assertEqual(lint_exclusion_reason(".planning/PROJECT.md"), "planning_artifact")
        self.assertIsNone(lint_exclusion_reason("apps/app-api/README.md"))
        self.assertIsNone(lint_exclusion_reason("apps/official-web-collector/README.md"))
        self.assertIsNone(
            lint_exclusion_reason(
                "apps/legacy-office-conversion-service/src/main/java/com/campusagent/legacyoffice/LegacyOfficeConversionService.java"
            )
        )
        self.assertEqual(
            lint_exclusion_reason(
                "apps/campus-web/docs/public/course-maps/law-ethnic-experimental-program/map-01.png"
            ),
            "binary_asset",
        )
        self.assertEqual(
            lint_exclusion_reason("apps/app-api/drizzle/0044_concerned_carmella_unuscione.sql"),
            "generated_drizzle_migration",
        )
        self.assertEqual(
            lint_exclusion_reason(
                "docs/runbooks/muc-wiki-visual-modernization-assets/MUCWikiSkin/skin.json"
            ),
            "runbook_visual_asset_snapshot",
        )
        self.assertEqual(
            lint_exclusion_reason(
                "docs/reference/muc-campus-qa-frontend-design/tokens/muc_campus_qa_design_tokens_v1_3_1.css"
            ),
            "design_reference_asset_snapshot",
        )

    def test_repo_inventory_has_no_uncovered_tracked_lint_candidates(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        self.assertEqual(audit_lint_coverage(root=repo_root), ())

    def test_tracked_lint_candidate_paths_skip_missing_tracked_files(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        with mock.patch("scripts.check_lint_coverage_tracked.subprocess.run") as run_mock:
            run_mock.return_value = unittest.mock.Mock(
                stdout=(
                    b"package.json\0"
                    b"apps/campus-web/docs/.missing/computer-science-ethnic-experimental-program.mdx\0"
                )
            )

            candidates = tracked_lint_candidate_paths(root=repo_root)

        self.assertEqual(candidates, ("package.json",))
