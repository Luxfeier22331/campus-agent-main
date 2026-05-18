from __future__ import annotations

from dataclasses import replace

from campus_contracts import EvidenceSource
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.evals.retrieval_benchmark_test_support import _source


def _answer_ready_anchor(
    *,
    answer_role: str = "supporting_detail",
    parent_unit_id: str = "test:unit",
    semantic_role: str = "",
    condition_subject: str = "generic_condition",
    condition_group_id: str = "",
    condition_group_subject: str = "",
    condition_polarity: str = "positive",
    procedure_step_index: int = 1,
    procedure_actor: str = "student",
    procedure_action: str = "apply",
    **extra: object,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "answer_role": answer_role,
        "parent_unit_id": parent_unit_id,
    }
    if semantic_role:
        payload["semantic_role"] = semantic_role
    if answer_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "material_requirement",
        "time_constraint",
        "table_fact",
    }:
        payload.update(
            {
                "condition_subject": condition_subject,
                "condition_group_id": condition_group_id or f"{parent_unit_id}:{condition_subject}",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "test:explicit",
                "condition_polarity": condition_polarity,
            }
        )
    elif answer_role == "supporting_detail" and condition_subject:
        payload.update(
            {
                "condition_subject": condition_subject,
                "condition_group_id": condition_group_id or f"{parent_unit_id}:{condition_subject}",
                "condition_group_subject": condition_group_subject or condition_subject,
                "condition_polarity": condition_polarity,
            }
        )
    if answer_role == "procedure_step":
        resolved_condition_group_subject = condition_group_subject or condition_subject
        payload.update(
            {
                "condition_subject": condition_subject,
                "condition_group_subject": resolved_condition_group_subject,
                "condition_group_id": condition_group_id
                or f"{parent_unit_id}:{resolved_condition_group_subject}",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "test:explicit",
                "procedure_step_index": procedure_step_index,
                "procedure_actor": procedure_actor,
                "procedure_action": procedure_action,
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "test:explicit",
                "condition_polarity": condition_polarity,
            }
        )
    payload.update(extra)
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


def _answer_ready_regulation_source(
    *,
    doc_id: str,
    collection: str = "student_rules",
    chunk_id: str = "chunk-1",
    source_title: str = "中央民族大学本科学生奖学金评定办法",
    snippet: str = "中央民族大学本科学生奖学金评定办法 相关依据。",
    detail_label: str = "",
    content_role: str = "primary_content",
    answer_role: str = "supporting_detail",
    semantic_role: str = "primary_content",
    condition_subject: str = "generic_condition",
    condition_polarity: str = "positive",
) -> EvidenceSource:
    parent_unit_id = f"{doc_id}:unit"
    return replace(
        _source(doc_id=doc_id, chunk_id=chunk_id),
        collection=collection,
        source_title=source_title,
        snippet=snippet,
        detail_label=detail_label,
        content_role=content_role,
        semantic_role=semantic_role,
        is_answer_bearing=True,
        anchor=_answer_ready_anchor(
            answer_role=answer_role,
            parent_unit_id=parent_unit_id,
            semantic_role=semantic_role,
            condition_subject=condition_subject,
            condition_group_id=f"{parent_unit_id}:{condition_subject}",
            condition_group_subject=condition_subject,
            condition_polarity=condition_polarity,
        ),
    )


def _diagnostic_source_for_request(request, *, doc_id: str | None = None) -> EvidenceSource:
    resolved_doc_id = (
        doc_id
        or (request.target_document_ids[0] if request.target_document_ids else "")
        or f"{request.collection}:doc"
    )
    title = _diagnostic_title_for_doc_id(resolved_doc_id) or str(request.query_text)
    if request.corpus == "curriculum" and request.collection == "curriculum_plan":
        resolved_doc_id = doc_id or _curriculum_doc_id_for_query(str(request.query_text))
        title = _curriculum_title_for_doc_id(resolved_doc_id) or title
    if request.corpus == "official_web" and request.collection == "stable_reference":
        resolved_doc_id = doc_id or _stable_reference_doc_id_for_query(str(request.query_text))
        title = _stable_reference_title_for_doc_id(resolved_doc_id) or title
    if request.corpus == "regulations" and request.collection in {
        "student_rules",
        "institutional_rules",
    }:
        return _answer_ready_regulation_source(
            doc_id=resolved_doc_id,
            collection=request.collection,
            source_title=title,
            snippet=f"{title} 相关依据。",
        )
    return replace(
        _source(doc_id=resolved_doc_id),
        collection=request.collection,
        source_title=title,
        snippet=f"{title} 相关依据。",
        content_role="primary_content",
        semantic_role="primary_content",
        is_answer_bearing=True,
    )


def _diagnostic_title_for_doc_id(doc_id: str) -> str:
    return {
        "institutional_regulation:muc:中央民族大学研究生-三助-工作管理办法:49319e7c44d3": "中央民族大学研究生“三助”工作管理办法",
        "institutional_regulation:muc:中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9": "中央民族大学丰台校区就医管理办法（暂行）",
        "institutional_regulation:muc:中央民族大学学生公费医疗管理办法:81401d3a02d6": "中央民族大学学生公费医疗管理办法",
        "institutional_regulation:muc:中央民族大学学生社团管理办法:7da72ac3d796": "中央民族大学学生社团管理办法",
        "institutional_regulation:muc:中央民族大学学费-住宿费收费管理规定:40d4d65809c5": "中央民族大学学费、住宿费收费管理规定",
        "institutional_regulation:muc:中央民族大学排课管理办法:e593d7a51e16": "中央民族大学排课管理办法",
    }.get(doc_id, "")


def _curriculum_doc_id_for_query(query_text: str) -> str:
    if "数字经济" in query_text:
        return "curriculum:数字经济本科人才培养方案"
    if "历史学" in query_text and "强基" in query_text:
        return "curriculum:历史学（强基计划）本科人才培养方案"
    if "民族学" in query_text:
        return "curriculum:民族学本科人才培养方案"
    return "curriculum_plan:doc"


def _curriculum_title_for_doc_id(doc_id: str) -> str:
    title = doc_id.split(":", 1)[-1] if ":" in doc_id else doc_id
    return title or "本科人才培养方案"


def _stable_reference_doc_id_for_query(query_text: str) -> str:
    if "概况" in query_text:
        return "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85"
    return "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487"


def _stable_reference_title_for_doc_id(doc_id: str) -> str:
    if doc_id.endswith("36021906c0348aa73ed1f5467c4cb57954295e85"):
        return "中央民族大学学校概况"
    if doc_id.endswith("e286aba2b39208a26af21e9dd518afc6faa49487"):
        return "中央民族大学学校简介"
    return ""


def _report(*, metric_name: str, cases: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "ragas-diagnostic-report.v1",
        "report_id": "ragas_diagnostic",
        "passed": True,
        "mode": "diagnostic_non_blocking",
        "run_config": {"metric_names": [metric_name]},
        "sample_manifest": {"metric_names": [metric_name]},
        "summary": {},
        "cases": cases,
    }


def _case(
    surface_key: str,
    case_id: str,
    metric_name: str,
    score: object,
) -> dict[str, object]:
    return {
        "surface_key": surface_key,
        "case_id": case_id,
        "split": "release_gate",
        "query": f"query {case_id}",
        "expected_doc_ids": [f"{case_id}:expected"],
        "forbidden_doc_ids": [],
        "status": "completed",
        "answer_text": f"answer {case_id}",
        "retrieved_context_count": 1,
        "retrieved_context_ids": [f"{case_id}:retrieved"],
        "raw_retrieved_doc_ids": [f"{case_id}:retrieved"],
        "selected_support_doc_ids": [f"{case_id}:retrieved"],
        "duration_ms": 1,
        "scores": {metric_name: score},
    }


def _discipline_relief_duration_source():
    return _answer_ready_regulation_source(
        doc_id="handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",
        source_title="中央民族大学解除学生纪律处分实施办法",
        detail_label="第三条",
        snippet=(
            "受警告、严重警告处分的学生,考察期满6个月后可申请解除处分;"
            "受记过、留校察看处分的学生,考察期满12个月后可申请解除处分。"
        ),
        content_role="eligibility",
        answer_role="eligibility_condition",
        semantic_role="eligibility_condition",
        condition_subject="discipline_relief_condition",
    )
