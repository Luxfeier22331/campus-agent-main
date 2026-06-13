from __future__ import annotations

import importlib
import json
import unittest
from collections.abc import Sequence
from pathlib import Path
from tempfile import TemporaryDirectory

worker = importlib.import_module("campus_ingestion_worker.official_web_university_collection")


class OfficialWebUniversityCollectionWorkerTest(unittest.TestCase):
    def test_preflight_accepts_consumer_stable_baseline_lane(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            repo_root = Path(__file__).resolve().parents[2]

            report = worker.run_official_web_university_collection_preflight(
                lane_id="consumer-stable-baseline",
                repo_root=repo_root,
                run_root=root / "runs",
                report_dir=root / "reports",
            )

        self.assertEqual(report["status"], "passed")
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["lane_is_university_lane"]["status"], "passed")
        self.assertEqual(checks["lane_hosts_group_allowed"]["status"], "passed")

    def test_preflight_rejects_non_university_lane_prefix(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_root = root / "config-root"
            _write_site_config(config_root=config_root, lane_id="college-core-demo")

            report = worker.run_official_web_university_collection_preflight(
                lane_id="college-core-demo",
                site_id="muc_public",
                config_root=config_root,
                run_root=root / "runs",
                report_dir=root / "reports",
            )

        self.assertEqual(report["status"], "failed")
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["lane_is_university_lane"]["status"], "failed")

    def test_preflight_rejects_missing_projection_declarations(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_root = root / "config-root"
            _write_site_config(
                config_root=config_root,
                lane_id="university-core-demo",
                include_all_page_families=False,
            )

            report = worker.run_official_web_university_collection_preflight(
                lane_id="university-core-demo",
                site_id="muc_public",
                config_root=config_root,
                run_root=root / "runs",
                report_dir=root / "reports",
            )

        self.assertEqual(report["status"], "failed")
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["lane_is_university_lane"]["status"], "passed")
        self.assertEqual(checks["projection_declarations_complete"]["status"], "failed")
        self.assertIn("data_table_page", checks["projection_declarations_complete"]["message"])

    def test_run_lane_executes_pipeline_and_import_dry_run(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_root = root / "config-root"
            _write_site_config(config_root=config_root, lane_id="university-core-demo")
            command_runner = _FakeCommandRunner(chunk_audit_passed=True)

            report = worker.run_official_web_university_collection_lane(
                lane_id="university-core-demo",
                site_id="muc_public",
                config_root=config_root,
                run_root=root / "runs",
                report_dir=root / "reports",
                run_id="run-001",
                skip_preflight=True,
                import_dry_run=True,
                command_runner=command_runner,
            )
            run_report_exists = Path(report["run_report_path"]).exists()

        self.assertEqual(report["status"], "succeeded")
        self.assertEqual(report["failed_step"], "")
        step_names = [step["name"] for step in report["steps"]]
        self.assertEqual(
            step_names,
            [
                "crawl",
                "validate",
                "qc_report",
                "projection_replay",
                "projection_validate",
                "chunk_audit",
                "import_dry_run:muc_public_pages",
            ],
        )
        self.assertTrue(run_report_exists)
        import_command = command_runner.commands[-1]
        self.assertIn("--dry-run", import_command)
        self.assertIn("--require-promotable", import_command)

    def test_run_lane_stops_on_chunk_audit_failure(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_root = root / "config-root"
            _write_site_config(config_root=config_root, lane_id="university-core-demo")
            command_runner = _FakeCommandRunner(chunk_audit_passed=False)

            report = worker.run_official_web_university_collection_lane(
                lane_id="university-core-demo",
                site_id="muc_public",
                config_root=config_root,
                run_root=root / "runs",
                report_dir=root / "reports",
                run_id="run-002",
                skip_preflight=True,
                import_dry_run=True,
                command_runner=command_runner,
            )

        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["failed_step"], "chunk_audit")
        step_names = [step["name"] for step in report["steps"]]
        self.assertNotIn("import_dry_run:muc_public_pages", step_names)

    def test_compare_reports_drop_and_duplicate_alerts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            previous_projection = root / "previous-projection"
            current_projection = root / "current-projection"
            previous_projection.mkdir()
            current_projection.mkdir()
            _write_projection_report(
                previous_projection / "projection-report.json",
                [
                    "https://www.muc.edu.cn/a.htm",
                    "https://www.muc.edu.cn/b.htm",
                    "https://www.muc.edu.cn/c.htm",
                ],
            )
            _write_projection_report(
                current_projection / "projection-report.json",
                [
                    "https://www.muc.edu.cn/a.htm",
                    "https://www.muc.edu.cn/a.htm",
                ],
            )
            previous_run_report = root / "previous-run.json"
            current_run_report = root / "current-run.json"
            previous_run_report.write_text(
                json.dumps({"projection_output_dir": str(previous_projection)}),
                encoding="utf-8",
            )
            current_run_report.write_text(
                json.dumps({"projection_output_dir": str(current_projection)}),
                encoding="utf-8",
            )

            report = worker.compare_official_web_university_collection_runs(
                current_run_report_path=current_run_report,
                previous_run_report_path=previous_run_report,
                drop_threshold_ratio=0.7,
                output_path=root / "compare.json",
            )
            alert_report = worker.build_official_web_university_collection_alert_summary(
                run_report={
                    "status": "succeeded",
                    "run_id": "run-003",
                    "lane_id": "consumer-stable-baseline",
                    "steps": [
                        {"name": "crawl", "status": "succeeded", "output_json": {"status": "ok"}},
                        {
                            "name": "validate",
                            "status": "succeeded",
                            "output_json": {"valid": True, "counts": {"errors": 0}},
                        },
                        {
                            "name": "qc_report",
                            "status": "succeeded",
                            "output_json": {
                                "valid": True,
                                "totals": {"failPages": 0, "unexpectedReviewPages": 0},
                            },
                        },
                        {
                            "name": "projection_replay",
                            "status": "succeeded",
                            "output_json": {"counts": {"emitted_documents": 2}},
                        },
                        {
                            "name": "projection_validate",
                            "status": "succeeded",
                            "output_json": {"valid": True, "counts": {"errors": 0}},
                        },
                        {
                            "name": "chunk_audit",
                            "status": "succeeded",
                            "output_json": {"passed": True},
                        },
                    ],
                },
                compare_report=report,
                drop_threshold_ratio=0.7,
            )

        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["counts"]["duplicate_canonical_url_count"], 1)
        self.assertEqual(report["drop_alert"], True)
        self.assertEqual(alert_report["status"], "alert")
        alert_codes = {alert["code"] for alert in alert_report["alerts"]}
        self.assertIn("repeated_run_compare_failed", alert_codes)
        self.assertIn("baseline_document_drop", alert_codes)


class _FakeCommandRunner:
    def __init__(self, *, chunk_audit_passed: bool) -> None:
        self._chunk_audit_passed = chunk_audit_passed
        self.commands: list[tuple[str, ...]] = []

    def __call__(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
    ) -> worker.CommandRunResult:
        del cwd
        command_tuple = tuple(command)
        self.commands.append(command_tuple)

        stdout: dict[str, object]
        if command_tuple[:4] == ("pnpm", "--dir", "apps/official-web-collector", "crawl"):
            stdout = {"status": "ok", "crawled_pages": 3}
        elif command_tuple[:4] == ("pnpm", "--dir", "apps/official-web-collector", "validate"):
            stdout = {"valid": True, "counts": {"errors": 0}}
        elif command_tuple[:4] == ("pnpm", "--dir", "apps/official-web-collector", "qc-report"):
            stdout = {"valid": True, "totals": {"failPages": 0, "unexpectedReviewPages": 0}}
        elif "campus_ingestion_worker.project_official_web_source_truth" in command_tuple:
            projection_output_dir = Path(
                command_tuple[command_tuple.index("--projection-output-dir") + 1]
            )
            _write_projection_report(
                projection_output_dir / "projection-report.json",
                [
                    "https://www.muc.edu.cn/a.htm",
                    "https://www.muc.edu.cn/b.htm",
                ],
            )
            projection_output_dir.mkdir(parents=True, exist_ok=True)
            stdout = {"counts": {"emitted_documents": 2}}
        elif "campus_ingestion_worker.validate_official_web_projection" in command_tuple:
            stdout = {"valid": True, "counts": {"errors": 0}}
        elif "campus_ingestion_worker.audit_official_web_projection_chunking" in command_tuple:
            stdout = {"passed": self._chunk_audit_passed}
        elif "campus_ingestion_worker.official_web_projection_import" in command_tuple:
            stdout = {"status": "succeeded", "success_count": 2}
        else:
            raise AssertionError(f"unexpected command: {command_tuple}")

        return worker.CommandRunResult(
            command=command_tuple,
            exit_code=0,
            stdout=json.dumps(stdout, ensure_ascii=False),
            stderr="",
            elapsed_seconds=0.01,
        )


def _write_projection_report(path: Path, urls: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "normalized_canonical_url": url,
                        "target_collection": "muc_public_pages",
                    }
                    for url in urls
                ],
            }
        ),
        encoding="utf-8",
    )


def _write_site_config(
    *,
    config_root: Path,
    lane_id: str,
    include_all_page_families: bool = True,
) -> None:
    site_root = config_root / "muc_public"
    site_root.mkdir(parents=True, exist_ok=True)
    (site_root / "scheduler-policy.json").write_text(
        json.dumps(
            {
                "lanes": [
                    {
                        "lane_id": lane_id,
                        "enabled": True,
                        "run_intent": "dev_closeout",
                        "host_filter": ["www.muc.edu.cn"],
                        "max_pages_per_host": 20,
                        "max_total_pages": 100,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (site_root / "hosts.json").write_text(
        json.dumps(
            {
                "hosts": [
                    {
                        "host": "www.muc.edu.cn",
                        "enabled": True,
                        "host_group": "university_core",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (site_root / "projection-declarations.json").write_text(
        json.dumps(
            {
                "schema_version": "official_web_projection_declarations.v1",
                "site_id": "muc_public",
                "projection_policy_version": "test_projection_policy_v1",
                "declarations": _test_declarations(
                    include_all_page_families=include_all_page_families
                ),
            }
        ),
        encoding="utf-8",
    )


def _test_declarations(*, include_all_page_families: bool = True) -> list[dict[str, str]]:
    declarations = [
        {
            "declaration_id": "test_article_detail_v1",
            "page_family": "article_detail",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "content_document",
            "document_kind": "article",
            "action": "emit_document",
        },
        {
            "declaration_id": "test_listing_page_v1",
            "page_family": "listing_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "navigation_document",
            "document_kind": "listing",
            "action": "emit_document",
        },
        {
            "declaration_id": "test_directory_page_v1",
            "page_family": "directory_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "directory_document",
            "document_kind": "directory",
            "action": "emit_document",
        },
        {
            "declaration_id": "test_sitemap_navigation_review_v1",
            "page_family": "sitemap_navigation_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "sitemap_review",
            "document_kind": "listing",
            "action": "manual_review",
        },
        {
            "declaration_id": "test_data_table_review_v1",
            "page_family": "data_table_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "table_review",
            "document_kind": "generic",
            "action": "manual_review",
        },
        {
            "declaration_id": "test_gallery_review_v1",
            "page_family": "gallery_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "gallery_review",
            "document_kind": "generic",
            "action": "manual_review",
        },
        {
            "declaration_id": "test_contact_widget_review_v1",
            "page_family": "contact_widget_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "contact_review",
            "document_kind": "directory",
            "action": "manual_review",
        },
        {
            "declaration_id": "test_generic_content_page_v1",
            "page_family": "generic_content_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "generic_content_document",
            "document_kind": "generic",
            "action": "emit_document",
        },
        {
            "declaration_id": "test_dynamic_shell_review_v1",
            "page_family": "dynamic_shell_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "shell_review",
            "document_kind": "shell",
            "action": "manual_review",
        },
        {
            "declaration_id": "test_structural_shell_review_v1",
            "page_family": "structural_shell_page",
            "target_corpus": "official_web",
            "target_collection": "muc_public_pages",
            "projection_family": "shell_review",
            "document_kind": "shell",
            "action": "manual_review",
        },
    ]
    if include_all_page_families:
        return declarations
    return [item for item in declarations if item["page_family"] != "data_table_page"]


if __name__ == "__main__":
    unittest.main()
