# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_official_web_source_pack_no_promotion_script_support import *


class OfficialWebSourcePackNoPromotionScriptTestPart01(unittest.TestCase):
    def test_script_module_supports_direct_execution_import_path_fix(self) -> None:
        path = Path("scripts/official_web_source_pack_no_promotion.py").read_text(encoding="utf-8")
        self.assertIn('if __package__ in {None, ""}:', path)
        self.assertIn("sys.path.insert(0, str(Path(__file__).resolve().parents[1]))", path)

    def test_load_source_pack_execution_plan_reads_manifest_plan(self) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            patch(
                "scripts.official_web_source_pack_no_promotion.run_json_command",
                return_value={
                    "siteId": "muc_public",
                    "sourcePackId": "tool-driven-first-slice.v1",
                    "rows": [],
                },
            ) as run_json_command,
        ):
            plan = load_source_pack_execution_plan(
                Path.cwd(),
                site_id="muc_public",
                source_pack_id="tool-driven-first-slice.v1",
                output_root=Path(temp_dir),
            )

        self.assertEqual(plan["sourcePackId"], "tool-driven-first-slice.v1")
        command = run_json_command.call_args.args[1]
        self.assertEqual(
            command[:4], ("pnpm", "--dir", "apps/official-web-collector", "plan-source-pack")
        )

    def test_load_source_pack_execution_plan_passes_non_default_source_pack_id(self) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            patch(
                "scripts.official_web_source_pack_no_promotion.run_json_command",
                return_value={
                    "siteId": "muc_public",
                    "sourcePackId": "official-web-regulation-expansion.v1",
                    "rows": [],
                },
            ) as run_json_command,
        ):
            plan = load_source_pack_execution_plan(
                Path.cwd(),
                site_id="muc_public",
                source_pack_id="official-web-regulation-expansion.v1",
                output_root=Path(temp_dir),
            )

        self.assertEqual(plan["sourcePackId"], "official-web-regulation-expansion.v1")
        command = run_json_command.call_args.args[1]
        self.assertIn("--source-pack-id", command)
        self.assertEqual(
            command[command.index("--source-pack-id") + 1],
            "official-web-regulation-expansion.v1",
        )

    def test_artifact_backed_object_store_reads_run_bundle_and_page_artifacts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            collector_output = output_root / "collector-output"
            page_dir = (
                collector_output / "source-assets" / "owasset_123" / "owver_456" / "source-truth"
            )
            page_dir.mkdir(parents=True, exist_ok=True)
            bundle_path = collector_output / "source-truth-bundle.json"
            bundle_path.write_text(
                json_dumps(
                    {
                        "siteId": "muc_public",
                        "crawlRunId": "owrun_current",
                        "pages": [
                            {
                                "rawAssetId": "owasset_123",
                                "rawVersionId": "owver_456",
                                "pageManifestObjectKey": "official_web/owasset_123/undated/owver_456/source-truth/page-manifest.json",
                                "contentBlocksObjectKey": "official_web/owasset_123/undated/owver_456/source-truth/content-blocks.jsonl",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (page_dir / "page-manifest.json").write_text(
                '{"host":"www.muc.edu.cn"}', encoding="utf-8"
            )
            (page_dir / "content-blocks.jsonl").write_text(
                '{"rowId":"1","textNormalized":"hello"}\n',
                encoding="utf-8",
            )

            store = ArtifactBackedOfficialWebSourceObjectStore(
                collector_output_dir=collector_output,
                site_id="muc_public",
                run_id="owrun_current",
            )

            bundle_bytes = store.get_bytes(
                bucket="source",
                key="official_web/muc_public/runs/owrun_current/source-truth-bundle.json",
            )
            manifest_bytes = store.get_bytes(
                bucket="source",
                key="official_web/owasset_123/undated/owver_456/source-truth/page-manifest.json",
            )
            blocks_bytes = store.get_bytes(
                bucket="source",
                key="official_web/owasset_123/undated/owver_456/source-truth/content-blocks.jsonl",
            )

        self.assertIn('"crawlRunId": "owrun_current"', bundle_bytes.decode("utf-8"))
        self.assertEqual('{"host":"www.muc.edu.cn"}', manifest_bytes.decode("utf-8"))
        self.assertIn('"textNormalized":"hello"', blocks_bytes.decode("utf-8"))

    def test_build_local_artifact_backed_consumer_result_replays_without_object_store_env(
        self,
    ) -> None:
        class _NoopReporter:
            def report(self, *, run_id: str, payload: dict[str, object]) -> None:
                _ = (run_id, payload)

        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            handoff_dir = output_root / "handoffs"
            collector_output = output_root / "collector-output"
            page_dir = (
                collector_output / "source-assets" / "owasset_123" / "owver_456" / "source-truth"
            )
            page_dir.mkdir(parents=True, exist_ok=True)
            handoff_dir.mkdir(parents=True, exist_ok=True)
            bundle_payload = {
                "schemaVersion": "official_web_source_truth_bundle.v1",
                "siteId": "muc_public",
                "crawlRunId": "owrun_current",
                "collectionMode": "target-workset",
                "pages": [
                    {
                        "rawAssetId": "owasset_123",
                        "rawVersionId": "owver_456",
                        "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "pageFamily": "article_detail",
                        "pageManifestObjectKey": "official_web/owasset_123/undated/owver_456/source-truth/page-manifest.json",
                        "contentBlocksObjectKey": "official_web/owasset_123/undated/owver_456/source-truth/content-blocks.jsonl",
                        "consumerMatches": [],
                        "consumerRetentionDecision": "retain_source_truth",
                        "targetMatches": [
                            {
                                "targetJobId": "owtarget_muc_public_official_web_stable_reference",
                                "targetCandidateId": "owcand_123",
                                "targetId": "official-web-stable-reference",
                                "targetDeclarationVersion": "muc_public_target_source_map_v2",
                                "consumerFamily": "stable_reference_candidate",
                                "retentionPolicy": "retain_source_truth",
                                "materializationPolicy": "release_gate_required",
                                "selectedWriteTarget": "official_web/stable_reference",
                                "reviewPolicy": "release_gate_required",
                                "worksetReason": "source_pack_seed",
                            }
                        ],
                    }
                ],
            }
            (collector_output / "source-truth-bundle.json").write_text(
                json_dumps(bundle_payload),
                encoding="utf-8",
            )
            (page_dir / "page-manifest.json").write_text(
                json_dumps(
                    {
                        "schemaVersion": "official_web_page_manifest.v1",
                        "sourceChannel": "official_web",
                        "siteId": "muc_public",
                        "host": "www.muc.edu.cn",
                        "rawAssetId": "owasset_123",
                        "rawVersionId": "owver_456",
                        "requestedUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "finalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "declaredCanonicalUrl": None,
                        "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "urlIdentityBasis": "final_url",
                        "fetchedAt": "2026-05-06T00:00:00+00:00",
                        "publishedAt": None,
                        "httpStatus": 200,
                        "contentType": "text/html; charset=utf-8",
                        "etag": None,
                        "lastModified": None,
                        "redirectChain": ["https://www.muc.edu.cn/xxgk1/xxjj.htm"],
                        "responseBodyHash": "hash",
                        "retainedSnapshotHash": "hash",
                        "fetcherName": "test",
                        "fetcherVersion": "1",
                        "parserName": "test",
                        "parserVersion": "1",
                        "pageTitleRaw": "学校简介",
                        "pageTitleNormalized": "学校简介",
                        "languageHint": "zh-CN",
                        "pageFamily": "article_detail",
                        "pageFamilyConfidence": 0.9,
                        "pageFamilyReason": None,
                        "mainContentHash": "mainhash",
                        "blockCount": 1,
                        "mainContentBlockCount": 1,
                        "navigationBlockCount": 0,
                        "boilerplateBlockCount": 0,
                        "discoveredFromUrl": None,
                        "discoveryMethod": "seed",
                        "crawlRunId": "owrun_current",
                        "hostPolicyVersion": "v1",
                        "crawlPolicyVersion": "v1",
                        "credentialsMode": "public",
                        "consumerDenominatorVersion": "v1",
                        "consumerMatches": [],
                        "consumerRetentionDecision": "retain_source_truth",
                        "targetMatches": [
                            {
                                "targetJobId": "owtarget_muc_public_official_web_stable_reference",
                                "targetCandidateId": "owcand_123",
                                "targetId": "official-web-stable-reference",
                                "targetDeclarationVersion": "muc_public_target_source_map_v2",
                                "consumerFamily": "stable_reference_candidate",
                                "retentionPolicy": "retain_source_truth",
                                "materializationPolicy": "release_gate_required",
                                "selectedWriteTarget": "official_web/stable_reference",
                                "reviewPolicy": "release_gate_required",
                                "worksetReason": "source_pack_seed",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (page_dir / "content-blocks.jsonl").write_text(
                json.dumps(
                    {
                        "schemaVersion": "official_web_content_block.v1",
                        "rawAssetId": "owasset_123",
                        "rawVersionId": "owver_456",
                        "rowId": "row1",
                        "rowIndex": 0,
                        "blockOrder": 0,
                        "blockRole": "paragraph",
                        "headingLevel": None,
                        "domPath": None,
                        "parentHeadingPath": [],
                        "listLevel": None,
                        "tableId": None,
                        "tableRowIndex": None,
                        "tableColIndex": None,
                        "textRaw": "学校简介",
                        "textNormalized": "学校简介",
                        "htmlFragment": None,
                        "linkTarget": None,
                        "linkText": None,
                        "tableHtml": None,
                        "tableCells": None,
                        "isNavigation": False,
                        "isBoilerplate": False,
                        "isMainContent": True,
                        "isRepeatedCandidate": False,
                        "mainContentScore": 1,
                        "titleCandidateScore": 0,
                        "sectionHint": None,
                        "classificationConfidence": 1,
                        "classificationReason": None,
                        "parentHeadingHint": None,
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            record_path = handoff_dir / "owevt_current.json"
            record_path.write_text(
                json_dumps(
                    {
                        "eventId": "owevt_current",
                        "processingStatus": "pending",
                        "processingAttemptCount": 0,
                        "payload": {
                            "eventId": "owevt_current",
                            "runId": "owrun_current",
                            "siteId": "muc_public",
                            "runIntent": "target_workset",
                            "status": "completed",
                            "artifacts": [],
                        },
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "scripts.official_web_source_pack_no_promotion.build_official_web_release_task_store_from_env",
                    return_value=None,
                ),
                patch(
                    "scripts.official_web_source_pack_no_promotion.query_app_api_run",
                    return_value={"crawl_run_id": "owrun_current"},
                ),
            ):
                consumer_result = build_local_artifact_backed_consumer_result(
                    repo_root=Path.cwd(),
                    output_root=output_root,
                    site_id="muc_public",
                    run_id="owrun_current",
                    event_id="owevt_current",
                    app_api_base_url="http://127.0.0.1:27031",
                    internal_shared_secret="secret",
                    status_reporter=_NoopReporter(),
                )

            self.assertEqual(consumer_result["counts"]["failed"], 0)
            self.assertEqual(consumer_result["counts"]["staged"], 1)
            execution_report_path = Path(consumer_result["results"][0]["execution_report_path"])
            execution_report = json.loads(execution_report_path.read_text(encoding="utf-8"))
            self.assertEqual(execution_report["status"], "staged")
            self.assertEqual(
                execution_report["bundleObjectKey"],
                "official_web/muc_public/runs/owrun_current/source-truth-bundle.json",
            )

    def test_build_source_pack_seed_plan_expands_per_target_rows(self) -> None:
        source_pack_plan = {
            "siteId": "muc_public",
            "sourcePackId": "tool-driven-first-slice.v1",
            "rows": [
                {
                    "entryId": "owsp-school-profile-xxjj",
                    "url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    "host": "www.muc.edu.cn",
                    "compositionGroup": None,
                    "compositionRole": None,
                    "targetMatches": [
                        {
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-school-profile-xxjj",
                            "consumerFamily": "stable_reference_candidate",
                            "materializationPolicy": "release_gate_required",
                            "ownerSurface": "official_web/stable_reference",
                            "retentionPolicy": "retain_source_truth",
                            "reviewPolicy": "release_gate_required",
                            "selectedWriteTarget": "official_web/stable_reference",
                            "targetId": "official-web-stable-reference",
                            "targetJobId": "owtarget_muc_public_official_web_stable_reference",
                        },
                        {
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-school-profile-xxjj",
                            "consumerFamily": "contact_directory_candidate",
                            "materializationPolicy": "candidate_only",
                            "ownerSurface": "contact_directory_lookup",
                            "retentionPolicy": "retain_source_truth",
                            "reviewPolicy": "selected_write_requires_review",
                            "selectedWriteTarget": "campus_services/contact_directory",
                            "targetId": "campus-services-contact-directory",
                            "targetJobId": "owtarget_muc_public_campus_services_contact_directory",
                        },
                    ],
                },
                {
                    "entryId": "owsp-info-disclosure-procedure-1113",
                    "url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    "host": "xxgk.muc.edu.cn",
                    "compositionGroup": "information_disclosure",
                    "compositionRole": "procedure_source",
                    "targetWorksetExpansion": "same_host_manual_requeue",
                    "targetMatches": [
                        {
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-info-disclosure-procedure-1113",
                            "compositionGroup": "information_disclosure",
                            "compositionRole": "procedure_source",
                            "consumerFamily": "service_guide_candidate",
                            "materializationPolicy": "candidate_only",
                            "ownerSurface": "service_guide_lookup",
                            "retentionPolicy": "retain_source_truth",
                            "reviewPolicy": "selected_write_requires_review",
                            "selectedWriteTarget": "campus_services/service_guide",
                            "targetId": "campus-services-service-guide",
                            "targetJobId": "owtarget_muc_public_campus_services_service_guide",
                        }
                    ],
                },
            ],
        }

        seed_plan = build_source_pack_seed_plan(source_pack_plan)

        self.assertEqual(seed_plan["seededRowCount"], 3)
        rows = seed_plan["rows"]
        self.assertEqual(
            {row["targetId"] for row in rows},
            {
                "official-web-stable-reference",
                "campus-services-contact-directory",
                "campus-services-service-guide",
            },
        )
        procedure_row = next(
            row for row in rows if row["targetId"] == "campus-services-service-guide"
        )
        self.assertEqual(procedure_row["compositionGroup"], "information_disclosure")
        self.assertEqual(procedure_row["compositionRole"], "procedure_source")
        self.assertEqual(procedure_row["worksetExpansion"], "same_host_manual_requeue")

    def test_build_collector_command_uses_single_batch_run_for_source_pack(self) -> None:
        with TemporaryDirectory() as temp_dir:
            args = type(
                "Args",
                (),
                {
                    "site_id": "muc_public",
                    "max_pages_per_host": 6,
                    "max_total_pages": 6,
                },
            )()
            target_seed = {
                "seededRows": [
                    {
                        "sourceHost": "www.muc.edu.cn",
                        "targetCandidateId": "owcand_school_profile_stable",
                        "targetUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    },
                    {
                        "sourceHost": "www.muc.edu.cn",
                        "targetCandidateId": "owcand_school_profile_contact",
                        "targetUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    },
                    {
                        "sourceHost": "xxgk.muc.edu.cn",
                        "targetCandidateId": "owcand_info_disclosure_procedure",
                        "targetUrl": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    },
                ]
            }
            lineage_path = Path(temp_dir) / "lineage.json"

            command = build_collector_command(
                args=args,
                local_run_id="owrun_source_pack_live_test",
                output_root=Path(temp_dir),
                target_seed=target_seed,
                source_pack_lineage_path=lineage_path,
            )

        self.assertEqual(command.count("--host"), 2)
        self.assertEqual(command.count("--target-candidate-id"), 3)
        self.assertIn("--source-pack-lineage-path", command)
        self.assertEqual(
            command[command.index("--source-pack-lineage-path") + 1],
            str(lineage_path),
        )

    def test_build_collector_command_adds_discovery_headroom_for_source_pack_preview_seeds(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            args = type(
                "Args",
                (),
                {
                    "site_id": "muc_public",
                    "max_pages_per_host": 6,
                    "max_total_pages": 6,
                },
            )()
            target_seed = {
                "seededRows": [
                    {
                        "sourceHost": "xxgk.muc.edu.cn",
                        "targetCandidateId": "owcand_student_listing",
                        "targetUrl": "https://xxgk.muc.edu.cn/xsgz/jwgl.htm",
                        "worksetExpansion": "same_host_manual_requeue",
                    },
                    {
                        "sourceHost": "xxgk.muc.edu.cn",
                        "targetCandidateId": "owcand_student_xszz",
                        "targetUrl": "https://xxgk.muc.edu.cn/xsgz/xszz.htm",
                        "worksetExpansion": "same_host_manual_requeue",
                    },
                    {
                        "sourceHost": "met.muc.edu.cn",
                        "targetCandidateId": "owcand_direct_rule",
                        "targetUrl": "https://met.muc.edu.cn/info/1024/1086.htm",
                        "worksetExpansion": None,
                    },
                ]
            }
            lineage_path = Path(temp_dir) / "lineage.json"

            command = build_collector_command(
                args=args,
                local_run_id="owrun_source_pack_live_test",
                output_root=Path(temp_dir),
                target_seed=target_seed,
                source_pack_lineage_path=lineage_path,
            )

        max_pages_per_host = command[command.index("--max-pages-per-host") + 1]
        max_total_pages = command[command.index("--max-total-pages") + 1]
        self.assertEqual(max_pages_per_host, "10")
        self.assertEqual(max_total_pages, "11")

    def test_build_collector_command_uses_returned_target_seed_workset_expansion_metadata(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            args = type(
                "Args",
                (),
                {
                    "site_id": "muc_public",
                    "max_pages_per_host": 6,
                    "max_total_pages": 6,
                },
            )()
            target_seed = {
                "seededRows": [
                    {
                        "sourceHost": "xxgk.muc.edu.cn",
                        "targetCandidateId": "owcand_student_listing",
                        "targetUrl": "https://xxgk.muc.edu.cn/xsgz/jwgl.htm",
                        "worksetExpansion": "same_host_manual_requeue",
                    }
                ]
            }
            lineage_path = Path(temp_dir) / "lineage.json"

            command = build_collector_command(
                args=args,
                local_run_id="owrun_source_pack_live_test",
                output_root=Path(temp_dir),
                target_seed=target_seed,
                source_pack_lineage_path=lineage_path,
            )

        max_pages_per_host = command[command.index("--max-pages-per-host") + 1]
        max_total_pages = command[command.index("--max-total-pages") + 1]
        self.assertEqual(max_pages_per_host, "6")
        self.assertEqual(max_total_pages, "6")

    def test_script_uses_direct_wrangler_command_for_custom_app_api_port(self) -> None:
        path = Path("scripts/official_web_source_pack_no_promotion.py").read_text(encoding="utf-8")
        self.assertIn('"pnpm"', path)
        self.assertIn('"apps/app-api"', path)
        self.assertIn('"exec"', path)
        self.assertIn('"wrangler"', path)
        self.assertIn('"--port"', path)
        self.assertIn("str(args.app_api_port)", path)

    def test_write_source_pack_lineage_overrides_uses_seeded_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            path = write_source_pack_lineage_overrides(
                output_root=output_root,
                target_seed={
                    "seededRows": [
                        {
                            "targetCandidateId": "owcand_info_disclosure_procedure",
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-info-disclosure-procedure-1113",
                            "compositionGroup": "information_disclosure",
                            "compositionRole": "procedure_source",
                        }
                    ]
                },
            )

            payload = path.read_text(encoding="utf-8")

        self.assertIn("owcand_info_disclosure_procedure", payload)
        self.assertIn('"compositionRole": "procedure_source"', payload)


if __name__ == "__main__":
    unittest.main()
