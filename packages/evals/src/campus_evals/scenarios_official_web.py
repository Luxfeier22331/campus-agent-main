from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from campus_contracts import ActorContext, KnowledgeScope

from campus_evals.models import GoldenCase, TraceExpectation, expected_source_ref
from campus_evals.official_web_inventory import (
    official_web_inventory_only_doc_ids_by_disposition,
)
from campus_evals.scenarios_shared import (
    official_web_fresh_news_scope,
    official_web_stable_reference_scope,
)

_REPO_ROOT = Path(__file__).resolve().parents[4]
_STABLE_REFERENCE_MANIFEST_PATH = (
    _REPO_ROOT
    / "configs"
    / "ingestion"
    / "official_web"
    / "stable_reference"
    / "split-manifest.v1.json"
)


def _official_web_reference_release_gate_cases(
    *,
    scope: KnowledgeScope,
    case_id_prefix: str,
) -> tuple[GoldenCase, ...]:
    return (
        GoldenCase(
            case_id=f"{case_id_prefix}-school-profile",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学学校简介",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "owdocver:239b3237c2259702ed1fe2955afe869303e943f6",
                ),
            ),
            required_facts=("中央民族大学", "延安民族学院", "双一流"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-teaching-research-units",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学教学和科研单位有哪些",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    "owdocver:043d9feb870de5219c0ff7de6bd065f9adc8b4c0",
                ),
            ),
            required_facts=("教学和科研单位",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-fee-disclosure",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学大学教育收费公示表",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:directory_page:9d7917bb1eb39649f02c6285c51280d811790cae",
                    "owdocver:493b69ab0ae0b4ec0173a18801ef809b4c694f1b",
                ),
            ),
            required_facts=("收费公示",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
    )


def _official_web_fail_close_release_gate_cases(
    *,
    scope: KnowledgeScope,
    case_id_prefix: str,
) -> tuple[GoldenCase, ...]:
    return (
        GoldenCase(
            case_id=f"{case_id_prefix}-freshness-sensitive-no-answer",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学今天有什么讲座",
            actor=ActorContext(),
            scope=scope,
            expected_status="no_answer",
            expected_semantic_outcome="freshness_fail_close",
            expected_scope_class="in_scope",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=False,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
            ),
            tags=("official_web", "release_gate", "freshness_fail_close"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-unanchored-life-service-no-answer",
            split="release_gate",
            source_type="expert_authored",
            user_goal="食堂营业时间",
            actor=ActorContext(),
            scope=scope,
            expected_status="no_answer",
            expected_semantic_outcome="unsupported_by_evidence",
            expected_scope_class="in_scope",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
            ),
            tags=("official_web", "release_gate", "fail_close"),
        ),
    )


def official_web_release_gate_cases() -> tuple[GoldenCase, ...]:
    scope = official_web_stable_reference_scope()
    cases = _official_web_reference_release_gate_cases(
        scope=scope,
        case_id_prefix="official-web-release-gate",
    ) + _official_web_fail_close_release_gate_cases(
        scope=scope,
        case_id_prefix="official-web-release-gate",
    )
    _validate_official_web_release_gate_cases(cases)
    return cases


def official_web_stable_reference_release_gate_cases() -> tuple[GoldenCase, ...]:
    scope = official_web_stable_reference_scope()
    return _official_web_reference_release_gate_cases(
        scope=scope,
        case_id_prefix="official-web-stable-reference-release-gate",
    ) + _official_web_fail_close_release_gate_cases(
        scope=scope,
        case_id_prefix="official-web-stable-reference-release-gate",
    )


def official_web_fresh_news_seed_validation_cases() -> tuple[GoldenCase, ...]:
    scope = official_web_fresh_news_scope()
    cases = (
        GoldenCase(
            case_id="official-web-fresh-news-seed-library-visit",
            split="smoke",
            source_type="expert_authored",
            user_goal="西北四所高校图书馆同仁到我校丰台校区图书馆考察调研",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:730b3e6266ad7b47dfc7dc82e83e9ea41090bf53",
                    "owdocver:fe7d2ffa13c025179f41146c4b86856d09aaa8d2",
                ),
            ),
            required_facts=("丰台校区图书馆",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-reading-class",
            split="smoke",
            source_type="expert_authored",
            user_goal="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:950afb54fe2745172658b9ba160ddf69dba02c6c",
                    "owdocver:e1afad1f0511f6c59dc052e7dee1947fae4ec7a5",
                ),
            ),
            required_facts=("正确政绩观", "读书班"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-employment-base",
            split="smoke",
            source_type="expert_authored",
            user_goal="中央民族大学与北京丰台人才集团共建就业实习实践基地",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:ac8ea5921fa808dea152c171d6b0c6c0ba1cc62f",
                    "owdocver:9be8a3dbe619d97df54d60cbe77d8903698b8fd3",
                ),
            ),
            required_facts=("北京丰台人才集团", "就业实习实践基地"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-employment-meeting",
            split="smoke",
            source_type="expert_authored",
            user_goal="校领导拜会北京市委组织部领导交流高质量就业工作",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:69b18ca70f673279950ef39cf1d3740f1bd1e067",
                    "owdocver:bcaca11c23ad203dedcd9d3967f60d437f0de87d",
                ),
            ),
            required_facts=("北京市委组织部", "高质量就业"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-hyperspectral-breakthrough",
            split="smoke",
            source_type="expert_authored",
            user_goal="中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:55174a666231a3cdb7fa4739121e1091eec6b0e9",
                    "owdocver:e3922645cf9811c97f6e100dec0afecbd7ed24cb",
                ),
            ),
            required_facts=("唐鑫团队", "红外高光谱成像系统"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-debate-championship",
            split="smoke",
            source_type="expert_authored",
            user_goal="外国语学院学子在2026中国大学生演讲与辩论锦标赛中喜获佳绩",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:8ee1f8f61b1ff362549a114c4ff6e5e9c7d54957",
                    "owdocver:34fda6dffebc2d009b03c2f34f9eada7681ffde7",
                ),
            ),
            required_facts=("外国语学院", "演讲与辩论锦标赛"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-history-research-bid",
            split="smoke",
            source_type="expert_authored",
            user_goal="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:fbace53c8842dd1fb6b11017383c5d2ced0eaff3",
                    "owdocver:56bcb501036683b529191ba685e3de910941679f",
                ),
            ),
            required_facts=("中国历史研究院", "开题论证会"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-seed-political-ethics-commentary",
            split="smoke",
            source_type="expert_authored",
            user_goal="《学习时报》孔新峰：政德何以重要",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:8a957d812e3bf832a450d7f3ed1845062db8b850",
                    "owdocver:5e739c818c83b0c9e7ba877e086bf2f6adc1aa1c",
                ),
            ),
            required_facts=("孔新峰", "政德何以重要"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "offline_seed", "fresh_news"),
        ),
    )
    expected_doc_ids = {
        source.doc_id
        for case in cases
        if case.expected_status == "completed"
        for source in case.expected_sources
    }
    fresh_news_doc_ids = official_web_inventory_only_doc_ids_by_disposition()[
        "future_fresh_news_surface"
    ]
    if expected_doc_ids != fresh_news_doc_ids:
        raise ValueError(
            "official_web fresh_news seed validation cases drifted from future fresh-news inventory "
            f"(cases={sorted(expected_doc_ids)}, inventory={sorted(fresh_news_doc_ids)})"
        )
    return cases


def _validate_official_web_release_gate_cases(cases: tuple[GoldenCase, ...]) -> None:
    expected_doc_ids = {
        source.doc_id
        for case in cases
        if case.expected_status == "completed"
        for source in case.expected_sources
    }
    manifest_doc_ids = _official_web_stable_reference_manifest_doc_ids()
    non_manifest_doc_ids = sorted(expected_doc_ids - manifest_doc_ids)
    if non_manifest_doc_ids:
        raise ValueError(
            "official_web stable_reference release gate cases drifted from split manifest "
            f"{non_manifest_doc_ids}"
        )


@lru_cache(maxsize=1)
def _official_web_stable_reference_manifest_doc_ids() -> frozenset[str]:
    payload = json.loads(_STABLE_REFERENCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    documents = payload.get("documents")
    if not isinstance(documents, list):
        raise ValueError("official_web stable_reference split manifest documents must be an array")
    return frozenset(
        str(document.get("document_id")).strip()
        for document in documents
        if isinstance(document, dict)
        and str(document.get("status") or "active") == "active"
        and str(document.get("document_id")).strip()
    )
