from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import (
    ActorContext,
    AgentResponse,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    TraceExpectation,
    load_official_web_current_truth_inventory,
    official_web_current_truth_doc_ids_by_bucket,
    official_web_future_fresh_news_doc_ids,
    official_web_future_fresh_news_titles,
    official_web_inventory_only_doc_ids_by_disposition,
    official_web_inventory_only_titles_by_disposition,
    official_web_release_gate_doc_ids,
    official_web_retain_inventory_only_doc_ids,
    official_web_retain_inventory_only_titles,
)
from campus_evals.official_web_live_benchmark import (
    build_default_output_dir,
    build_official_web_live_executor,
    build_official_web_live_profile,
    main,
)
from campus_evals.scenarios import (
    official_web_fresh_news_release_gate_cases,
    official_web_fresh_news_scope,
    official_web_release_gate_cases,
    official_web_stable_reference_release_gate_cases,
    official_web_stable_reference_scope,
)

OFFICIAL_WEB_SCOPE = KnowledgeScope(corpus="official_web", collection="muc_public_pages")
OFFICIAL_WEB_STABLE_REFERENCE_SCOPE = KnowledgeScope(
    corpus="official_web", collection="stable_reference"
)
OFFICIAL_WEB_FRESH_NEWS_SCOPE = KnowledgeScope(corpus="official_web", collection="fresh_news")
OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "official_web_muc_public_pages_current_truth_inventory.json"
)


def _source(
    doc_id: str,
    *,
    version_id: str = "owdocver:test",
    chunk_id: str = "chunk-0001",
    score: float = 0.9,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="official_web",
        collection="muc_public_pages",
        is_current=True,
        snippet=f"snippet for {doc_id}",
        score=score,
        source_title=doc_id,
    )


def _case(
    *,
    case_id: str = "official-web-release-gate-school-profile",
    user_goal: str = "中央民族大学学校简介",
    expected_status: str = "completed",
    scope: KnowledgeScope = OFFICIAL_WEB_SCOPE,
) -> GoldenCase:
    return GoldenCase(
        case_id=case_id,
        split="release_gate",
        source_type="expert_authored",
        user_goal=user_goal,
        actor=ActorContext(),
        scope=scope,
        expected_status=expected_status,
        trace_expectation=TraceExpectation(
            selected_scope=scope,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=False,
            fail_closed_expected=(expected_status == "no_answer"),
        ),
    )


class OfficialWebLiveExecutorTest(unittest.TestCase):
    def test_official_web_stable_reference_scope_helper_exposes_split_scope(self) -> None:
        self.assertEqual(
            official_web_stable_reference_scope(),
            KnowledgeScope(corpus="official_web", collection="stable_reference"),
        )

    def test_official_web_fresh_news_scope_helper_exposes_split_scope(self) -> None:
        self.assertEqual(
            official_web_fresh_news_scope(),
            KnowledgeScope(corpus="official_web", collection="fresh_news"),
        )

    def test_build_official_web_live_executor_captures_retrieved_and_supporting_sources(
        self,
    ) -> None:
        retrieved_bundle = EvidenceBundle(
            query_text="中央民族大学学校简介",
            corpus="official_web",
            collection="muc_public_pages",
            sources=(
                _source(
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    version_id="owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                ),
                _source(
                    "official_web:muc_public:article_detail:background",
                    chunk_id="chunk-0002",
                    score=0.7,
                ),
            ),
        )
        supporting_source = retrieved_bundle.sources[0]

        def fake_delegate(request, *, retriever):
            bundle = retriever(
                request.user_goal,
                corpus=request.payload.scope.corpus,
                collection=request.payload.scope.collection,
                personalization_hint=None,
            )
            self.assertEqual(bundle, retrieved_bundle)
            return AgentResponse(
                target="rag-agent",
                status="completed",
                answer_text="根据官网页面内容，《学校简介》明确：中央民族大学是一所特色鲜明的高等院校。",
                confidence="medium",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus=bundle.corpus,
                        collection=bundle.collection,
                        sources=(supporting_source,),
                    )
                ),
            )

        executor = build_official_web_live_executor(
            retriever=lambda *args, **kwargs: retrieved_bundle,
            delegate=fake_delegate,
        )

        result = executor(_case())

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(result.observed_trace.selected_scope, OFFICIAL_WEB_SCOPE)
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertFalse(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, retrieved_bundle.sources)
        self.assertEqual(result.observed_trace.supporting_sources, (supporting_source,))


class OfficialWebLiveProfileTest(unittest.TestCase):
    def test_official_web_release_gate_cases_align_with_inventory_fixture(self) -> None:
        cases = official_web_release_gate_cases()
        expected_doc_ids = {
            source.doc_id
            for case in cases
            if case.expected_status == "completed"
            for source in case.expected_sources
        }
        inventory_only_doc_ids = {
            doc_id
            for doc_ids in official_web_inventory_only_doc_ids_by_disposition().values()
            for doc_id in doc_ids
        }

        self.assertEqual(expected_doc_ids, official_web_release_gate_doc_ids())
        self.assertFalse(expected_doc_ids & inventory_only_doc_ids)

    def test_build_official_web_live_profile_uses_deterministic_only_policy_and_no_supplemental_adapters(
        self,
    ) -> None:
        profile = build_official_web_live_profile(
            qdrant_collection_name="muc_public_pages__r20260403_074311",
        )

        self.assertEqual(profile.profile_id, "official_web")
        self.assertEqual(profile.benchmark_type, "official_web_live_gate")
        self.assertEqual(Path(profile.policy_path).name, "official_web_live_gate_policy.json")
        self.assertEqual(profile.http_settings.read_timeout_seconds, 180.0)
        self.assertEqual(profile.supplemental_adapters_factory(), ())

    def test_official_web_release_gate_cases_cover_foundation_and_school_overview_regressions(
        self,
    ) -> None:
        case_ids = {case.case_id for case in official_web_release_gate_cases()}

        self.assertIn("official-web-release-gate-foundation-profile", case_ids)
        self.assertIn("official-web-release-gate-school-overview", case_ids)

    def test_official_web_release_gate_cases_cover_second_batch_reference_pages(self) -> None:
        case_ids = {case.case_id for case in official_web_release_gate_cases()}

        self.assertIn("official-web-release-gate-undergraduate-education", case_ids)
        self.assertIn("official-web-release-gate-postdoctoral-program", case_ids)
        self.assertIn("official-web-release-gate-graduate-education", case_ids)
        self.assertIn("official-web-release-gate-scholars", case_ids)
        self.assertNotIn("official-web-release-gate-visiting-scholar-program", case_ids)

    def test_official_web_release_gate_cases_cover_freshness_sensitive_fail_close(self) -> None:
        cases = {case.case_id: case for case in official_web_release_gate_cases()}

        self.assertIn("official-web-release-gate-freshness-sensitive-no-answer", cases)
        freshness_case = cases["official-web-release-gate-freshness-sensitive-no-answer"]
        self.assertEqual(freshness_case.expected_status, "no_answer")
        self.assertEqual(freshness_case.expected_semantic_outcome, "freshness_fail_close")
        self.assertEqual(freshness_case.expected_scope_class, "in_scope")
        self.assertTrue(freshness_case.trace_expectation.fail_closed_expected)
        self.assertIn("freshness_fail_close", freshness_case.tags)

        unsupported_case = cases["official-web-release-gate-unanchored-life-service-no-answer"]
        self.assertEqual(unsupported_case.expected_status, "no_answer")
        self.assertEqual(unsupported_case.expected_semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(unsupported_case.expected_scope_class, "in_scope")

    def test_official_web_release_gate_cases_lock_answer_quality_constraints(self) -> None:
        cases = {case.case_id: case for case in official_web_release_gate_cases()}

        self.assertEqual(
            cases["official-web-release-gate-school-overview"].required_facts,
            ("三个校区", "12个学科门类"),
        )
        self.assertEqual(
            cases["official-web-release-gate-school-overview"].forbidden_claims,
            ("延安民族学院", "双一流"),
        )
        self.assertEqual(
            cases["official-web-release-gate-library-lecture-notice"].forbidden_claims,
            ("二维码", "线上腾讯会议"),
        )
        self.assertEqual(
            cases["official-web-release-gate-law-interpretation"].forbidden_claims,
            ("承载着怎样的历史使命与时代内涵",),
        )
        self.assertEqual(
            cases["official-web-release-gate-undergraduate-education"].required_facts,
            ("本科专业71个", "3个专业入选国家“强基计划”"),
        )
        self.assertEqual(
            cases["official-web-release-gate-undergraduate-education"].forbidden_claims,
            ("担当使命", "强国栋梁"),
        )
        self.assertEqual(
            cases["official-web-release-gate-postdoctoral-program"].required_facts,
            ("6个博士后科研流动站", "合格率均为100％"),
        )
        self.assertEqual(
            cases["official-web-release-gate-postdoctoral-program"].forbidden_claims,
            ("双一流",),
        )
        self.assertEqual(
            cases["official-web-release-gate-graduate-education"].required_facts,
            ("12个学科门类", "24个研究生招生培养单位"),
        )
        self.assertEqual(
            cases["official-web-release-gate-graduate-education"].forbidden_claims,
            ("600余项", "500多人"),
        )
        self.assertEqual(
            cases["official-web-release-gate-scholars"].required_facts,
            ("陈振铎", "翦伯赞", "杨成志"),
        )
        self.assertEqual(
            cases["official-web-release-gate-scholars"].forbidden_claims,
            ("1919年", "副校长", "1934年赴法国留学"),
        )

    def test_official_web_inventory_helper_matches_repo_tracked_fixture(self) -> None:
        payload = load_official_web_current_truth_inventory()

        self.assertEqual(payload["document_count"], 21)
        self.assertEqual(
            payload["inventory_triage_summary"],
            {
                "retain_inventory_only": 2,
                "current_scope_follow_up_candidate": 0,
                "future_fresh_news_surface": 8,
            },
        )

    def test_official_web_current_truth_inventory_tracks_21_promotable_documents_and_release_gate_subset(
        self,
    ) -> None:
        payload = json.loads(OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH.read_text(encoding="utf-8"))
        entries = tuple(payload["documents"])

        self.assertEqual(payload["corpus"], "official_web")
        self.assertEqual(payload["collection"], "muc_public_pages")
        self.assertEqual(len(entries), 21)
        self.assertTrue(all(entry["serving_intent"] == "promotable" for entry in entries))
        status_by_title = {entry["title"]: entry["answer_gate_status"] for entry in entries}
        self.assertEqual(status_by_title["本科培养"], "release_gate_required")
        self.assertEqual(status_by_title["博士后"], "release_gate_required")
        self.assertEqual(status_by_title["研究生培养"], "release_gate_required")
        self.assertEqual(status_by_title["学术名流"], "release_gate_required")
        self.assertEqual(status_by_title["访问学者"], "inventory_only")

        release_gate_doc_ids = {
            entry["doc_id"]
            for entry in entries
            if entry["answer_gate_status"] == "release_gate_required"
        }
        self.assertEqual(
            release_gate_doc_ids,
            {
                "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                "official_web:muc_public:article_detail:43fdab9acbf0e68e67fddba209463e97d0b2fe4e",
                "official_web:muc_public:article_detail:3f735e1c08be05c5426948f7ea737d3d422c6e02",
                "official_web:muc_public:article_detail:3342689d05d43819a48bbcf7564f013f217ffe46",
                "official_web:muc_public:article_detail:b6e3922bbc68f5bfe601407b62e4c2de47a0f226",
                "official_web:muc_public:article_detail:871878763a91199730493efe0cbb0358b884fe58",
                "official_web:muc_public:article_detail:dfd33d034080e7df93a707edef7f555a95d78b13",
                "official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                "official_web:muc_public:article_detail:d043e2b8d29c0023c945a9c5909cb09b1f68d0ca",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
            },
        )

    def test_official_web_current_truth_inventory_tracks_inventory_only_triage(self) -> None:
        payload = json.loads(OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH.read_text(encoding="utf-8"))
        entries = tuple(payload["documents"])
        inventory_entries = tuple(
            entry for entry in entries if entry["answer_gate_status"] == "inventory_only"
        )

        triage_counts: dict[str, int] = {}
        for entry in inventory_entries:
            disposition = entry["inventory_disposition"]
            triage_counts[disposition] = triage_counts.get(disposition, 0) + 1

        self.assertEqual(
            payload["inventory_triage_summary"],
            {
                "retain_inventory_only": 2,
                "current_scope_follow_up_candidate": 0,
                "future_fresh_news_surface": 8,
            },
        )
        self.assertEqual(
            triage_counts,
            {
                "retain_inventory_only": 2,
                "future_fresh_news_surface": 8,
            },
        )

        disposition_by_title = {
            entry["title"]: entry["inventory_disposition"] for entry in inventory_entries
        }
        self.assertEqual(disposition_by_title["访问学者"], "retain_inventory_only")
        self.assertEqual(disposition_by_title["干部人事"], "retain_inventory_only")
        self.assertNotIn("学术名流", disposition_by_title)
        self.assertEqual(
            disposition_by_title["中央民族大学与北京丰台人才集团共建就业实习实践基地"],
            "future_fresh_news_surface",
        )

    def test_official_web_inventory_helper_exposes_titles_by_disposition(self) -> None:
        self.assertEqual(
            official_web_inventory_only_titles_by_disposition(),
            {
                "current_scope_follow_up_candidate": frozenset(),
                "future_fresh_news_surface": frozenset(
                    {
                        "《学习时报》孔新峰：政德何以重要",
                        "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        "中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        "中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        "中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                        "外国语学院学子在2026中国大学生演讲与辩论锦标赛中喜获佳绩",
                        "校领导拜会北京市委组织部领导交流高质量就业工作",
                        "西北四所高校图书馆同仁到我校丰台校区图书馆考察调研",
                    }
                ),
                "retain_inventory_only": frozenset({"访问学者", "干部人事"}),
            },
        )

    def test_official_web_current_truth_partition_helper_exposes_frozen_handoff_buckets(
        self,
    ) -> None:
        partition = official_web_current_truth_doc_ids_by_bucket()
        payload = load_official_web_current_truth_inventory()
        all_doc_ids = {
            str(entry["doc_id"]) for entry in payload["documents"] if isinstance(entry, dict)
        }

        self.assertEqual(
            set(partition),
            {
                "release_gate_required",
                "retain_inventory_only",
                "current_scope_follow_up_candidate",
                "future_fresh_news_surface",
            },
        )
        self.assertEqual(
            set().union(*partition.values()),
            all_doc_ids,
        )
        self.assertEqual(
            sum(len(doc_ids) for doc_ids in partition.values()),
            payload["document_count"],
        )
        self.assertEqual(
            partition["release_gate_required"],
            official_web_release_gate_doc_ids(),
        )
        self.assertEqual(
            partition["retain_inventory_only"],
            official_web_retain_inventory_only_doc_ids(),
        )
        self.assertEqual(
            partition["future_fresh_news_surface"],
            official_web_future_fresh_news_doc_ids(),
        )
        self.assertEqual(partition["current_scope_follow_up_candidate"], frozenset())

    def test_official_web_future_fresh_news_helpers_lock_current_seed_set(self) -> None:
        self.assertEqual(
            official_web_future_fresh_news_titles(),
            frozenset(
                {
                    "《学习时报》孔新峰：政德何以重要",
                    "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    "中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                    "中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                    "中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                    "外国语学院学子在2026中国大学生演讲与辩论锦标赛中喜获佳绩",
                    "校领导拜会北京市委组织部领导交流高质量就业工作",
                    "西北四所高校图书馆同仁到我校丰台校区图书馆考察调研",
                }
            ),
        )
        self.assertEqual(
            official_web_future_fresh_news_doc_ids(),
            official_web_inventory_only_doc_ids_by_disposition()["future_fresh_news_surface"],
        )

    def test_official_web_retain_inventory_only_helpers_lock_non_gate_scope(self) -> None:
        self.assertEqual(
            official_web_retain_inventory_only_titles(),
            frozenset({"访问学者", "干部人事"}),
        )
        self.assertEqual(
            official_web_retain_inventory_only_doc_ids(),
            official_web_inventory_only_doc_ids_by_disposition()["retain_inventory_only"],
        )

    def test_official_web_stable_reference_release_gate_cases_use_split_scope_only(self) -> None:
        cases = official_web_stable_reference_release_gate_cases()
        case_ids = {case.case_id for case in cases}

        self.assertEqual(
            case_ids,
            {
                "official-web-stable-reference-release-gate-school-profile",
                "official-web-stable-reference-release-gate-school-overview",
                "official-web-stable-reference-release-gate-current-leadership",
                "official-web-stable-reference-release-gate-alumni-profile",
                "official-web-stable-reference-release-gate-foundation-profile",
                "official-web-stable-reference-release-gate-undergraduate-education",
                "official-web-stable-reference-release-gate-postdoctoral-program",
                "official-web-stable-reference-release-gate-graduate-education",
                "official-web-stable-reference-release-gate-scholars",
                "official-web-stable-reference-release-gate-freshness-sensitive-no-answer",
                "official-web-stable-reference-release-gate-unanchored-life-service-no-answer",
            },
        )
        self.assertTrue(all(case.scope == OFFICIAL_WEB_STABLE_REFERENCE_SCOPE for case in cases))
        self.assertNotIn("official-web-release-gate-library-lecture-notice", case_ids)
        self.assertNotIn("official-web-release-gate-law-interpretation", case_ids)

    def test_build_official_web_live_profile_supports_stable_reference_scope(self) -> None:
        profile = build_official_web_live_profile(
            scope_key="stable_reference",
        )

        self.assertEqual(profile.profile_id, "official_web_stable_reference")
        self.assertEqual(profile.benchmark_type, "official_web_stable_reference_live_gate")
        self.assertEqual(
            profile.repair_benchmark_type, "official_web_stable_reference_live_gate_repair"
        )
        self.assertEqual(profile.run_prefix, "official-web-stable-reference-live-gate")
        self.assertEqual(profile.repair_prefix, "official-web-stable-reference-live-gate-repair")
        self.assertEqual(
            profile.cases_factory(), official_web_stable_reference_release_gate_cases()
        )

    def test_official_web_fresh_news_release_gate_cases_use_seed_scope_only(self) -> None:
        cases = official_web_fresh_news_release_gate_cases()
        case_ids = {case.case_id for case in cases}
        expected_doc_ids = {
            source.doc_id
            for case in cases
            if case.expected_status == "completed"
            for source in case.expected_sources
        }

        self.assertEqual(
            case_ids,
            {
                "official-web-fresh-news-release-gate-library-visit",
                "official-web-fresh-news-release-gate-reading-class",
                "official-web-fresh-news-release-gate-employment-base",
                "official-web-fresh-news-release-gate-employment-meeting",
                "official-web-fresh-news-release-gate-hyperspectral-breakthrough",
                "official-web-fresh-news-release-gate-debate-championship",
                "official-web-fresh-news-release-gate-history-research-bid",
                "official-web-fresh-news-release-gate-political-ethics-commentary",
            },
        )
        self.assertTrue(all(case.scope == OFFICIAL_WEB_FRESH_NEWS_SCOPE for case in cases))
        self.assertEqual(expected_doc_ids, official_web_future_fresh_news_doc_ids())
        self.assertTrue(
            all(
                source.doc_id.split(":")[2] == "article_detail"
                for case in cases
                for source in case.expected_sources
            )
        )

    def test_build_official_web_live_profile_supports_fresh_news_scope(self) -> None:
        profile = build_official_web_live_profile(
            scope_key="fresh_news",
        )

        self.assertEqual(profile.profile_id, "official_web_fresh_news")
        self.assertEqual(profile.benchmark_type, "official_web_fresh_news_live_gate")
        self.assertEqual(profile.repair_benchmark_type, "official_web_fresh_news_live_gate_repair")
        self.assertEqual(profile.run_prefix, "official-web-fresh-news-live-gate")
        self.assertEqual(profile.repair_prefix, "official-web-fresh-news-live-gate-repair")
        self.assertEqual(profile.cases_factory(), official_web_fresh_news_release_gate_cases())


class OfficialWebLiveBenchmarkCliTest(unittest.TestCase):
    def test_build_default_output_dir_uses_timestamped_eval_directory(self) -> None:
        path = build_default_output_dir(
            prefix="official-web-live-gate", timestamp="20260403T074311"
        )
        self.assertEqual(path, Path(".tmp/evals/official-web-live-gate-20260403T074311"))

    def test_main_runs_formal_benchmark_with_collection_override(self) -> None:
        case = _case()

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = Path(tmpdir) / "official-web-live-gate-20260403T074311"
            with (
                patch(
                    "campus_evals.official_web_live_benchmark.official_web_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.build_official_web_live_executor",
                    return_value="executor",
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.run_formal_benchmark"
                ) as run_benchmark,
            ):
                exit_code = main(
                    [
                        "run",
                        "--reruns",
                        "1",
                        "--qdrant-collection-name",
                        "muc_public_pages__r20260403_074311",
                    ]
                )

        self.assertEqual(exit_code, 0)
        run_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=(),
            output_dir=expected_output_dir,
            reruns=1,
            case_workers=1,
            policy_path=Path(run_benchmark.call_args.kwargs["policy_path"]),
            benchmark_type="official_web_live_gate",
        )

    def test_main_runs_formal_benchmark_with_stable_reference_scope(self) -> None:
        case = _case(
            case_id="official-web-stable-reference-release-gate-school-profile",
            scope=OFFICIAL_WEB_STABLE_REFERENCE_SCOPE,
        )

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = (
                Path(tmpdir) / "official-web-stable-reference-live-gate-20260403T074311"
            )
            with (
                patch(
                    "campus_evals.official_web_live_benchmark.official_web_stable_reference_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.build_official_web_live_executor",
                    return_value="executor",
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.run_formal_benchmark"
                ) as run_benchmark,
            ):
                exit_code = main(
                    [
                        "run",
                        "--reruns",
                        "1",
                        "--official-web-scope",
                        "stable_reference",
                    ]
                )

        self.assertEqual(exit_code, 0)
        run_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=(),
            output_dir=expected_output_dir,
            reruns=1,
            case_workers=1,
            policy_path=Path(run_benchmark.call_args.kwargs["policy_path"]),
            benchmark_type="official_web_stable_reference_live_gate",
        )

    def test_main_runs_formal_benchmark_with_fresh_news_scope(self) -> None:
        case = _case(
            case_id="official-web-fresh-news-release-gate-library-visit",
            user_goal="西北四所高校图书馆同仁到我校丰台校区图书馆考察调研",
            scope=OFFICIAL_WEB_FRESH_NEWS_SCOPE,
        )

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = Path(tmpdir) / "official-web-fresh-news-live-gate-20260403T074311"
            with (
                patch(
                    "campus_evals.official_web_live_benchmark.official_web_fresh_news_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.build_official_web_live_executor",
                    return_value="executor",
                ),
                patch(
                    "campus_evals.official_web_live_benchmark.run_formal_benchmark"
                ) as run_benchmark,
            ):
                exit_code = main(
                    [
                        "run",
                        "--reruns",
                        "1",
                        "--official-web-scope",
                        "fresh_news",
                    ]
                )

        self.assertEqual(exit_code, 0)
        run_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=(),
            output_dir=expected_output_dir,
            reruns=1,
            case_workers=1,
            policy_path=Path(run_benchmark.call_args.kwargs["policy_path"]),
            benchmark_type="official_web_fresh_news_live_gate",
        )
