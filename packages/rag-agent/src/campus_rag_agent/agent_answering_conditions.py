from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_answering_materials import compose_material_requirement_answer
from .agent_condition_duration import (
    condition_duration_subject_label,
    extract_condition_duration_parts,
    query_asks_condition_duration_lookup,
)
from .agent_shared import _answer_prefix, _lead_source_title, _normalize_snippet


@dataclass(frozen=True, slots=True)
class _ConditionAnswerRow:
    source: EvidenceSource
    statement: str
    context_label: str


_CONDITION_DIMENSION_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "思想品德与诚信",
        (
            "思想",
            "品德",
            "道德",
            "品行",
            "诚信",
            "诚实守信",
            "遵纪守法",
            "规章制度",
            "热爱祖国",
            "拥护中国共产党",
            "民族团结",
            "国家统一",
        ),
    ),
    (
        "学习与综合表现",
        (
            "学习成绩",
            "学业成绩",
            "成绩",
            "综合测评",
            "综合考评",
            "综合表现",
            "排名",
            "学业",
            "课程",
            "学分",
            "成绩优良",
            "成绩优秀",
        ),
    ),
    ("经济困难与生活状况", ("家庭经济困难", "经济困难", "生活俭朴", "困难认定")),
    (
        "项目专项要求",
        (
            "具体项目",
            "项目要求",
            "专项",
            "该项",
            "相应条件",
            "评选要求",
            "当年通知",
            "学院细则",
            "通知",
        ),
    ),
    ("材料与证明", ("材料", "证明", "申请表", "申请书", "提交")),
    ("时间与期限", ("截止", "期限", "日内", "工作日", "公示期")),
    ("身份与适用范围", ("全日制", "在校", "正式学籍", "学籍", "学生身份")),
    ("名额金额与等级", ("名额", "金额", "奖金", "比例", "额度", "奖学金等级", "奖励等级")),
    ("限制或排除情形", ("不得", "不予", "不能", "取消资格", "无资格", "排除")),
)


def _compose_condition_table_answer(
    *,
    evidence: EvidenceBundle,
    query_text: str = "",
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    rows: list[_ConditionAnswerRow] = []
    for source, statements in selected_rows:
        statement = next((_normalize_snippet(item) for item in statements if item.strip()), "")
        if not statement:
            continue
        statement = statement.rstrip("。；; ")
        statement = _normalize_condition_answer_statement(statement)
        context_label = _condition_row_context_label(source)
        rows.append(
            _ConditionAnswerRow(
                source=source,
                statement=statement,
                context_label=context_label,
            )
        )
    if not rows:
        return ""
    rendered_rows = "；".join(_render_condition_answer_row(row) for row in rows)
    dimension_summary = _condition_dimension_summary(tuple(rows))
    answer_query_text = query_text.strip() or evidence.query_text
    answer_frame = _condition_answer_frame(query_text=answer_query_text, rows=tuple(rows))
    if dimension_summary:
        body = f"{dimension_summary}；分制度依据：{rendered_rows}"
    elif threshold_body := _single_source_threshold_condition_body(
        query_text=answer_query_text,
        rows=tuple(rows),
    ):
        return threshold_body
    elif duration_body := _duration_condition_body(
        query_text=answer_query_text,
        rows=tuple(rows),
    ):
        return duration_body
    elif hearing_body := _hearing_application_deadline_body(
        query_text=answer_query_text,
        rows=tuple(rows),
    ):
        return hearing_body
    elif material_body := compose_material_requirement_answer(
        query_text=answer_query_text,
        rows=tuple((row.statement, row.context_label) for row in rows),
    ):
        return material_body
    elif single_source_title := _single_condition_source_title(tuple(rows)):
        if subject_label := _single_source_condition_subject_label(answer_query_text):
            rendered_statements = _render_single_source_subject_condition_rows(tuple(rows))
            body = f"{subject_label}：{rendered_statements}。依据《{single_source_title}》。"
        else:
            rendered_statements = "；".join(row.statement for row in rows)
            body = f"依据{single_source_title}：{rendered_statements}"
    elif single_context_label := _single_condition_context_label(tuple(rows)):
        rendered_statements = "；".join(row.statement for row in rows)
        body = f"依据{single_context_label}：{rendered_statements}"
    else:
        body = f"相关条件包括：{rendered_rows}"
    if answer_frame:
        return f"{answer_frame}。{body}"
    return f"{_answer_prefix(evidence)}，{body}"


def _render_condition_answer_row(row: _ConditionAnswerRow) -> str:
    if row.context_label:
        return f"{row.context_label}：{row.statement}"
    return row.statement


def _normalize_condition_answer_statement(statement: str) -> str:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    if not normalized:
        return ""
    scope_match = re.fullmatch(
        r"(?P<scope>[^，,。；;]{0,24})只允许使用(?P<allowed>[^，,。；;]+)"
        r"[，,](?P<restricted>其他[^。；;]+)",
        normalized,
    )
    if scope_match is None:
        return normalized
    scope = scope_match.group("scope").strip()
    allowed = scope_match.group("allowed").strip(" ，,")
    restricted = scope_match.group("restricted").strip(" ，,")
    if not allowed or not restricted:
        return normalized
    if scope:
        return f"{scope}允许使用的范围包括：{allowed}；{restricted}"
    return f"允许使用的范围包括：{allowed}；{restricted}"


def _render_single_source_subject_condition_rows(rows: tuple[_ConditionAnswerRow, ...]) -> str:
    return "。".join(row.statement.rstrip("。；; ") for row in rows if row.statement)


def _single_condition_context_label(rows: tuple[_ConditionAnswerRow, ...]) -> str:
    context_labels = {row.context_label for row in rows if row.context_label}
    if len(context_labels) != 1:
        return ""
    return next(iter(context_labels))


def _single_condition_source_title(rows: tuple[_ConditionAnswerRow, ...]) -> str:
    titles = {_lead_source_title((row.source,)) for row in rows}
    titles.discard("")
    if len(titles) != 1:
        return ""
    return next(iter(titles))


def _single_source_condition_subject_label(query_text: str) -> str:
    normalized_query = _normalize_snippet(query_text)
    if not normalized_query:
        return ""
    if "宿舍照明" in normalized_query:
        return "宿舍照明安排"
    if "电器" in normalized_query and "管理" in normalized_query:
        return "电器使用管理"
    return ""


def _single_source_threshold_condition_body(
    *,
    query_text: str,
    rows: tuple[_ConditionAnswerRow, ...],
) -> str:
    if not _query_asks_threshold_lookup(query_text):
        return ""
    single_context_label = _single_condition_context_label(rows)
    if not single_context_label:
        return ""
    quantified_rows = tuple(row for row in rows if _condition_row_has_numeric_threshold(row))
    if len(quantified_rows) < 2:
        return ""
    rendered_statements = "；".join(row.statement for row in quantified_rows)
    threshold_label = _condition_threshold_subject_label(query_text)
    if threshold_label == "旷课按违纪处理":
        threshold_entry = _absence_threshold_entry_fragment(quantified_rows[0].statement)
        return (
            "制度原文没有使用“学时”，而是按“节”统计；"
            f"{threshold_entry}即进入违纪处理分档。完整分档："
            f"{rendered_statements}。依据{single_context_label}。"
        )
    return f"{threshold_label}的阈值或分档如下：{rendered_statements}。依据{single_context_label}。"


def _query_asks_threshold_lookup(query_text: str) -> bool:
    normalized = _normalize_snippet(query_text)
    if not normalized:
        return False
    return any(cue in normalized for cue in ("多少", "几", "达到", "超过")) and any(
        cue in normalized for cue in ("学时", "课时", "节", "分", "名", "人", "元", "比例")
    )


def _duration_condition_body(
    *,
    query_text: str,
    rows: tuple[_ConditionAnswerRow, ...],
) -> str:
    if not _query_asks_duration_lookup(query_text):
        return ""
    duration_rows = tuple(row for row in rows if _extract_duration_condition_parts(row.statement))
    if not duration_rows:
        return ""
    duration_parts = tuple(
        part for row in duration_rows for part in _extract_duration_condition_parts(row.statement)
    )
    if not duration_parts:
        return ""
    context_labels = tuple(
        dict.fromkeys(row.context_label for row in duration_rows if row.context_label)
    )
    if not context_labels:
        return ""
    source_tail = (
        f"。依据{context_labels[0]}。"
        if len(context_labels) == 1
        else f"。依据{'；'.join(context_labels)}。"
    )
    return (
        f"{_condition_duration_subject_label(query_text)}："
        f"{'；'.join(dict.fromkeys(duration_parts))}{source_tail}"
    )


def _query_asks_duration_lookup(query_text: str) -> bool:
    return query_asks_condition_duration_lookup(query_text)


def _hearing_application_deadline_body(
    *,
    query_text: str,
    rows: tuple[_ConditionAnswerRow, ...],
) -> str:
    normalized_query = _normalize_snippet(query_text)
    if "听证" not in normalized_query:
        return ""
    if not any(cue in normalized_query for cue in ("什么时候", "何时", "申请听证", "听证申请")):
        return ""
    relevant_rows = tuple(row for row in rows if "听证" in row.statement)
    if not relevant_rows:
        return ""
    statement = relevant_rows[0].statement.rstrip("。；; ")
    right_fragment = _extract_hearing_right_fragment(statement)
    deadline_fragment = _extract_hearing_deadline_fragment(statement)
    if not right_fragment or not deadline_fragment:
        return ""
    application_deadline = deadline_fragment
    if application_deadline.startswith("如有听证要求"):
        application_deadline = application_deadline.removeprefix("如有听证要求").strip(" ，,")
    if application_deadline.startswith("应"):
        application_deadline = application_deadline.removeprefix("应")
    return (
        "申请听证的时间要求：拟被处分或者处理的学生可以"
        f"{application_deadline}；可申请前提：{right_fragment}。"
    )


def _extract_hearing_right_fragment(statement: str) -> str:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    marker = "有要求听证的权利"
    marker_index = normalized.find(marker)
    if marker_index < 0:
        return ""
    subject = "拟被处分或者处理的学生"
    subject_index = normalized.rfind(subject, 0, marker_index)
    if subject_index < 0:
        return ""
    start = subject_index
    return normalized[start : marker_index + len(marker)].strip(" ，,。；;")


def _extract_hearing_deadline_fragment(statement: str) -> str:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    match = re.search(
        r"(?:拟被处分或者处理的学生)?如有听证要求,?应在收到拟处分或处理告知书后"
        r"10日内提交书面听证申请",
        normalized,
    )
    if match is None:
        return ""
    fragment = match.group(0).strip(" ，,。；;")
    if fragment.startswith("拟被处分或者处理的学生"):
        fragment = fragment.removeprefix("拟被处分或者处理的学生")
    return fragment


def _extract_duration_condition_parts(statement: str) -> tuple[str, ...]:
    return extract_condition_duration_parts(statement)


def _condition_duration_subject_label(query_text: str) -> str:
    return condition_duration_subject_label(query_text)


def _condition_row_has_numeric_threshold(row: _ConditionAnswerRow) -> bool:
    return bool(
        re.search(
            r"\d+(?:\s*[-－—至到]\s*\d+)?\s*(?:节|学时|课时|分|名|人|元|%|％|比例)",
            row.statement,
        )
    )


def _absence_threshold_entry_fragment(statement: str) -> str:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    match = re.match(
        r"(?P<threshold>一学期累计旷课(?:达)?\d+(?:\s*[-－—至到]\s*\d+)?"
        r"\s*节(?:\\(含\\)|（含）)?(?:以下|以上)?)者",
        normalized,
    )
    if match is None:
        return normalized
    return match.group("threshold")


def _condition_threshold_subject_label(query_text: str) -> str:
    normalized = _normalize_snippet(query_text)
    if "旷课" in normalized and "违纪" in normalized:
        return "旷课按违纪处理"
    if "旷课" in normalized:
        return "旷课处理"
    return "该条件"


def _condition_dimension_summary(rows: tuple[_ConditionAnswerRow, ...]) -> str:
    if len({row.source.doc_id for row in rows if row.source.doc_id}) < 2:
        return ""
    dimensions = _condition_dimension_labels(rows)
    if not dimensions:
        return ""
    return "条件维度主要包括：" + "、".join(dimensions)


def _condition_answer_frame(
    *,
    query_text: str,
    rows: tuple[_ConditionAnswerRow, ...],
) -> str:
    normalized_query = _normalize_snippet(query_text)
    if not normalized_query:
        return ""
    if _query_asks_absence_discipline_threshold(normalized_query, rows=rows):
        return "旷课按违纪处理的阈值或分档如下"
    application_subject = _condition_application_subject(normalized_query)
    if application_subject:
        return f"申请{application_subject}需要满足以下条件"
    return ""


def _query_asks_absence_discipline_threshold(
    query_text: str,
    *,
    rows: tuple[_ConditionAnswerRow, ...],
) -> bool:
    if "旷课" not in query_text:
        return False
    if not any(cue in query_text for cue in ("多少", "学时", "课时", "节", "违纪处理")):
        return False
    row_text = "".join(row.statement for row in rows)
    return "旷课" in row_text and any(cue in row_text for cue in ("节", "学时", "课时"))


def _condition_application_subject(query_text: str) -> str:
    for pattern in (
        r"申请(?P<subject>[^，,。?？]{1,40}?)(?:需要|需|要|应当|应该|须|必须)?(?:满足|具备)",
        r"(?P<subject>[^，,。?？]{1,40}?)(?:申请)?条件(?:是|有哪些|是什么)",
    ):
        match = re.search(pattern, query_text)
        if match is None:
            continue
        subject = _normalize_condition_application_subject(match.group("subject"))
        if subject:
            return subject
    return ""


def _normalize_condition_application_subject(subject: str) -> str:
    normalized = _normalize_snippet(subject).strip(" ，,。?？:：")
    normalized = re.sub(r"^(?:我|学生|本科生|研究生|校级)?(?:想|要|可以)?申请", "", normalized)
    normalized = re.sub(r"(?:需要|需|要|应当|应该|须|必须)$", "", normalized)
    normalized = normalized.strip(" ，,。?？:：")
    if not normalized or len(normalized) > 40:
        return ""
    return normalized


def _condition_dimension_labels(rows: tuple[_ConditionAnswerRow, ...]) -> tuple[str, ...]:
    matched: list[str] = []
    for label, cues in _CONDITION_DIMENSION_RULES:
        if any(_condition_row_matches_dimension(row, cues=cues) for row in rows):
            matched.append(label)
        if len(matched) >= 4:
            break
    return tuple(matched)


def _condition_row_matches_dimension(row: _ConditionAnswerRow, *, cues: tuple[str, ...]) -> bool:
    compact = "".join(
        _normalize_snippet(fragment)
        for fragment in (
            row.statement,
            row.context_label,
        )
        if fragment
    )
    if not compact:
        return False
    return any(cue in compact for cue in cues)


def _condition_row_context_label(source: EvidenceSource) -> str:
    title = _lead_source_title((source,))
    detail_label = _normalize_snippet(source.detail_label)
    if title and detail_label:
        return f"{title} {detail_label}"
    return title or detail_label


__all__ = ["_compose_condition_table_answer"]
