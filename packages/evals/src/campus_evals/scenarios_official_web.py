from __future__ import annotations

from campus_contracts import ActorContext, KnowledgeScope

from campus_evals.models import GoldenCase, TraceExpectation, expected_source_ref
from campus_evals.official_web_inventory import (
    official_web_current_truth_doc_ids_by_bucket,
    official_web_inventory_only_doc_ids_by_disposition,
)
from campus_evals.scenarios_shared import (
    _official_web_scope,
    official_web_fresh_news_scope,
    official_web_stable_reference_scope,
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
                    "owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                ),
            ),
            forbidden_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    "owdocver:f7ee81c9f937fe14f493a81e4e5b5b815f2995e6",
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
            case_id=f"{case_id_prefix}-school-overview",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学学校概况",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    "owdocver:f7ee81c9f937fe14f493a81e4e5b5b815f2995e6",
                ),
            ),
            forbidden_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                ),
            ),
            required_facts=("三个校区", "12个学科门类"),
            forbidden_claims=("延安民族学院", "双一流"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-current-leadership",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学现任领导",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:43fdab9acbf0e68e67fddba209463e97d0b2fe4e",
                    "owdocver:14935f44e582597fdebffe3e8f2bcc9921e2fd06",
                ),
            ),
            forbidden_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:df9f5e313546d24c7a384598d1b676d6b005d881",
                    "owdocver:1970a7c8d052144896ffd12d5785055720c8fa82",
                ),
            ),
            required_facts=("查显友", "强世功"),
            forbidden_claims=("安徽怀宁人", "博士生导师"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-alumni-profile",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学校友会简介",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:3f735e1c08be05c5426948f7ea737d3d422c6e02",
                    "owdocver:4377c56414af31a83481c8a63deb5aa51e0baa50",
                ),
            ),
            forbidden_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:3342689d05d43819a48bbcf7564f013f217ffe46",
                    "owdocver:b804aee18c6ba82af29a8f0dca36ac0e92f550aa",
                ),
            ),
            required_facts=("校友会简介", "服务校友"),
            forbidden_claims=("高举习近平新时代中国特色社会主义思想", "阔步前行"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-foundation-profile",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学基金会简介",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:3342689d05d43819a48bbcf7564f013f217ffe46",
                    "owdocver:b804aee18c6ba82af29a8f0dca36ac0e92f550aa",
                ),
            ),
            forbidden_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:3f735e1c08be05c5426948f7ea737d3d422c6e02",
                    "owdocver:4377c56414af31a83481c8a63deb5aa51e0baa50",
                ),
            ),
            required_facts=("姚佳琳", "白勇"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-undergraduate-education",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学本科培养",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:dfd33d034080e7df93a707edef7f555a95d78b13",
                    "owdocver:0d26c91eeefd72d7cfbb5f194d077108d35a1f02",
                ),
            ),
            required_facts=("本科专业71个", "3个专业入选国家“强基计划”"),
            forbidden_claims=("担当使命", "强国栋梁"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-postdoctoral-program",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学博士后",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                    "owdocver:522c255c713a682644556a362c4547689d0d1754",
                ),
            ),
            required_facts=("6个博士后科研流动站", "合格率均为100％"),
            forbidden_claims=("双一流",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-graduate-education",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学研究生培养",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:d043e2b8d29c0023c945a9c5909cb09b1f68d0ca",
                    "owdocver:2009a50d7181bf21a7ee5f4521ce0eb1149dc0b0",
                ),
            ),
            required_facts=("12个学科门类", "24个研究生招生培养单位"),
            forbidden_claims=("600余项", "500多人"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
        GoldenCase(
            case_id=f"{case_id_prefix}-scholars",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学学术名流",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    "owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981",
                    "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:source-faithful:owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981:chunk-0015",
                ),
                expected_source_ref(
                    "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    "owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981",
                    "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:source-faithful:owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981:chunk-0001",
                ),
                expected_source_ref(
                    "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    "owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981",
                    "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:source-faithful:owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981:chunk-0011",
                ),
            ),
            required_facts=("陈振铎", "翦伯赞", "杨成志"),
            forbidden_claims=("1919年", "副校长", "1934年赴法国留学"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "stable_reference"),
        ),
    )


def _official_web_mixed_only_release_gate_cases(*, scope: KnowledgeScope) -> tuple[GoldenCase, ...]:
    return (
        GoldenCase(
            case_id="official-web-release-gate-library-lecture-notice",
            split="release_gate",
            source_type="expert_authored",
            user_goal="民图一小时 信息素养讲座",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:b6e3922bbc68f5bfe601407b62e4c2de47a0f226",
                    "owdocver:71ac6c6da0c348bf08fcd7911fc1e09fb4e0555e",
                ),
            ),
            forbidden_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:730b3e6266ad7b47dfc7dc82e83e9ea41090bf53",
                    "owdocver:fe7d2ffa13c025179f41146c4b86856d09aaa8d2",
                ),
            ),
            required_facts=("人大复印报刊资料数据库", "14:00", "丰台校区图书馆视听空间125室"),
            forbidden_claims=("二维码", "线上腾讯会议"),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "notice"),
        ),
        GoldenCase(
            case_id="official-web-release-gate-law-interpretation",
            split="release_gate",
            source_type="expert_authored",
            user_goal="民族团结进步促进法 解读",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    "official_web:muc_public:article_detail:871878763a91199730493efe0cbb0358b884fe58",
                    "owdocver:fa5f1f590e722118a3800d65e8e95125af62c74a",
                ),
            ),
            required_facts=("民族团结进步促进法", "统战新语", "强世功"),
            forbidden_claims=("承载着怎样的历史使命与时代内涵",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("official_web", "release_gate", "news"),
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
                retrieval_called=True,
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
    scope = _official_web_scope()
    cases = (
        _official_web_reference_release_gate_cases(
            scope=scope,
            case_id_prefix="official-web-release-gate",
        )
        + _official_web_mixed_only_release_gate_cases(scope=scope)
        + _official_web_fail_close_release_gate_cases(
            scope=scope,
            case_id_prefix="official-web-release-gate",
        )
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


def official_web_fresh_news_release_gate_cases() -> tuple[GoldenCase, ...]:
    scope = official_web_fresh_news_scope()
    cases = (
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-library-visit",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-reading-class",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-employment-base",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-employment-meeting",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-hyperspectral-breakthrough",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-debate-championship",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-history-research-bid",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
        ),
        GoldenCase(
            case_id="official-web-fresh-news-release-gate-political-ethics-commentary",
            split="release_gate",
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
            tags=("official_web", "release_gate", "fresh_news"),
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
            "official_web fresh_news release gate cases drifted from future fresh-news inventory "
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
    current_truth_partition = official_web_current_truth_doc_ids_by_bucket()
    release_gate_doc_ids = current_truth_partition["release_gate_required"]
    if expected_doc_ids != release_gate_doc_ids:
        raise ValueError(
            "official_web release gate cases drifted from current truth inventory "
            f"(cases={sorted(expected_doc_ids)}, inventory={sorted(release_gate_doc_ids)})"
        )

    inventory_only_doc_ids = {
        *current_truth_partition["retain_inventory_only"],
        *current_truth_partition["current_scope_follow_up_candidate"],
        *current_truth_partition["future_fresh_news_surface"],
    }
    unexpected_inventory_only_doc_ids = sorted(expected_doc_ids & inventory_only_doc_ids)
    if unexpected_inventory_only_doc_ids:
        raise ValueError(
            "official_web release gate cases unexpectedly depend on inventory_only docs "
            f"{unexpected_inventory_only_doc_ids}"
        )
