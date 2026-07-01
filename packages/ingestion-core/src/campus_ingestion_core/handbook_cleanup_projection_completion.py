from __future__ import annotations

from campus_ingestion_core.source_truth_common import infer_list_level_hint

_REPAIRABLE_ROW_TYPES = frozenset({"list_item"})
_TERMINAL_ENDINGS = ("。", "；", ";", "！", "!", "？", "?", "：", ":", "）", ")", "”", '"')
_MIN_REPAIR_PREFIX_LENGTH = 12
_MAX_REPAIR_SUFFIX_LENGTH = 12
_STUDENT_STATUS_POLICY_TITLE = "示例大学本科学生学籍管理办法"
_STUDENT_STATUS_ARTICLE_42_TRUNCATED_PREFIX = (
    "第四十二条 学生退学处理由所在学院(系)提出处理意见,文件"
)
_STUDENT_STATUS_ARTICLE_43_PREFIX = "第四十三条"
_STUDENT_STATUS_SOURCE_REPAIR_URL = "https://xingong.example.edu/info/1080/1935.htm"

_STUDENT_STATUS_ARTICLE_42 = (
    "第四十二条 学生退学处理由所在学院(系)提出处理意见,报学生处;学生申请退学的,"
    "本人填写申请表报所在学院(系),学院(系)应及时告知学生监护人并要求其签署书面意见。"
    "学院(系)研究同意后,由主管领导签字盖章,报学生处,学生处研究后再报主管校领导审批。"
)

_STUDENT_STATUS_SOURCE_GAP_ROWS = (
    (
        "paragraph",
        "第四十三条 退学学生按下列规定办理:",
    ),
    (
        "list_item",
        "\n".join(
            (
                "(一)对学生的退学处理,由校长办公会或授权的专门会议研究决定。",
                "(二)对退学的学生,由学校出具退学决定书并送交本人,无法送达本人的,"
                "在校内公告即视为送达。",
                "(三)学生对学校的退学处理决定有异议的,可按学校有关规定向学校学生申诉处理委员会提出书面申诉。",
                "(四)退学学生应在一周内办理离校手续,户口和档案退回入学前户籍所在地。",
                "(五)经诊断,患有严重疾病(包括非学校责任导致的意外致残)而不符合体检标准者,由法定监护人领回。",
                "(六)学满一学年以上(含)退学的学生发给肄业证书。",
            )
        ),
    ),
    (
        "paragraph",
        "第四十四条 退学学生的档案由学校退回其家庭所在地,户口应当按照国家相关规定迁回原户籍地或者家庭户籍所在地。",
    ),
    ("heading", "第七章 毕业与结业"),
    (
        "paragraph",
        "第四十五条 学制为4年的,学习年限为3-6年,学制为5年的,学习年限为4-7年。学生毕业时间一般为每年的6月。",
    ),
    (
        "paragraph",
        "第四十六条 在学制年限内,修完本科专业培养方案规定内容,成绩合格,获得规定的学分,"
        "德、智、体达到学校毕业要求的,准予毕业,并发给毕业证书。符合学位授予条件的,颁发学位证书。",
    ),
    (
        "paragraph",
        "第四十七条 学生通过每学期适当多选或提前选修课程,在学制年限内提前修完本科专业培养方案规定内容并达到毕业要求者,"
        "经本人书面申请,学院(系)审查后,报教务处审核,经学校批准,方可提前一年毕业。提前毕业的学生,"
        "按学校规定应缴足学费。",
    ),
    (
        "paragraph",
        "第四十八条 在学制年限内,修完本科专业培养方案规定内容但未达到毕业要求,"
        "平均学分绩点低于2.0且已获得学分达到专业培养方案三分之二及以上者,按结业处理。",
    ),
    (
        "paragraph",
        "\n".join(
            (
                "第四十九条 学制年限内结业的学生可在结业后二年内向学校申请重修。"
                "申请回校重修,要按学校有关规定缴纳学费。重修成绩合格,达到毕业要求的换发毕业证书,"
                "毕业时间按发证日期填写。逾期不申请或经考核仍不合格的,不再给予重修机会。",
                "若在返校重修课程(或者教学环节)考试中有违反考试纪律或弄虚作假的行为,取消其换发毕业证书资格。",
            )
        ),
    ),
    (
        "paragraph",
        "\n".join(
            (
                "第五十条 在学制年限内,未完成本专业培养方案规定的学分且平均学分绩点达到2.0及以上者,"
                "可申请延长学习年限。未申请或自愿结业离校的按结业处理。",
                "延长学习年限由学生申请、学院(系)审核、学校批准,期限为半年或一年。学生须按学校规定缴纳学费。"
                "延长学习年限期间,不参评奖助学金,不享受校内生活补贴。",
                "延长学习年限期满仍未达到毕业要求的,按结业处理。结业后一年内,可以申请返校重修,"
                "重修成绩合格,达到毕业要求的换发毕业证书。",
            )
        ),
    ),
    (
        "paragraph",
        "第五十一条 延长学习年限、结业换毕业的学生,符合学士学位授予条件的,可申请授予学士学位。",
    ),
    ("heading", "第八章 学业证书管理"),
    (
        "paragraph",
        "\n".join(
            (
                "第五十二条 学校严格按照招生时确定的办学类型和学习形式,以及学生招生录取时填报的个人信息,"
                "填写、颁发学历证书、学位证书及其他学业证书。",
                "学生在校期间变更姓名、出生日期等证书需填写的个人信息的,应当有合理、充分的理由,"
                "并提供有法定效力的相应证明文件。",
            )
        ),
    ),
)


def repair_projected_content_rows(
    *,
    content_rows: list[dict[str, object]],
    structured_rows: list[dict[str, object]],
    title: str | None = None,
) -> list[dict[str, object]]:
    donor_lines = _collect_donor_lines(structured_rows)
    repaired_rows: list[dict[str, object]] = []
    for row in content_rows:
        row_type = str(row.get("row_type") or "")
        text = str(row.get("text_normalized") or "")
        if not donor_lines or row_type not in _REPAIRABLE_ROW_TYPES or not text.strip():
            repaired_rows.append(row)
            continue
        repaired_text = _repair_multiline_text(text=text, donor_lines=donor_lines)
        if repaired_text == text:
            repaired_rows.append(row)
            continue
        repaired_row = dict(row)
        repaired_row["text_normalized"] = repaired_text
        repaired_row["text_raw"] = repaired_text
        repaired_rows.append(repaired_row)
    return _repair_known_source_gaps(repaired_rows, title=title)


def _collect_donor_lines(rows: list[dict[str, object]]) -> tuple[str, ...]:
    donors: set[str] = set()
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") not in {"paragraph", "list_item"}:
            continue
        for line in str(row.get("text_normalized") or "").splitlines():
            candidate = line.strip()
            if _is_complete_donor_line(candidate):
                donors.add(candidate)
    return tuple(sorted(donors))


def _repair_multiline_text(*, text: str, donor_lines: tuple[str, ...]) -> str:
    repaired_lines: list[str] = []
    changed = False
    for line in text.splitlines():
        stripped = line.strip()
        repaired_line = stripped
        if _is_repairable_prefix(stripped):
            repaired_candidate = _resolve_unique_completion(
                prefix=stripped, donor_lines=donor_lines
            )
            if repaired_candidate is not None:
                repaired_line = repaired_candidate
                changed = True
        repaired_lines.append(
            repaired_line if line == stripped else line.replace(stripped, repaired_line, 1)
        )
    return "\n".join(repaired_lines) if changed else text


def _is_complete_donor_line(text: str) -> bool:
    return bool(text and text.endswith(_TERMINAL_ENDINGS))


def _is_repairable_prefix(text: str) -> bool:
    return bool(
        text
        and len(text) >= _MIN_REPAIR_PREFIX_LENGTH
        and not text.endswith(_TERMINAL_ENDINGS)
        and infer_list_level_hint(text) is not None
    )


def _resolve_unique_completion(
    *,
    prefix: str,
    donor_lines: tuple[str, ...],
) -> str | None:
    matches = {
        candidate
        for candidate in donor_lines
        if candidate != prefix
        and candidate.startswith(prefix)
        and 0 < len(candidate) - len(prefix) <= _MAX_REPAIR_SUFFIX_LENGTH
    }
    if len(matches) != 1:
        return None
    return next(iter(matches))


def _repair_known_source_gaps(
    content_rows: list[dict[str, object]],
    *,
    title: str | None,
) -> list[dict[str, object]]:
    if title != _STUDENT_STATUS_POLICY_TITLE:
        return content_rows
    if any(
        str(row.get("text_normalized") or "").strip().startswith(_STUDENT_STATUS_ARTICLE_43_PREFIX)
        for row in content_rows
    ):
        return content_rows

    repaired_rows: list[dict[str, object]] = []
    repaired = False
    for row in content_rows:
        text = str(row.get("text_normalized") or "").strip()
        if not repaired and text.startswith(_STUDENT_STATUS_ARTICLE_42_TRUNCATED_PREFIX):
            repaired_rows.append(
                _build_source_gap_row(
                    template=row,
                    text=_STUDENT_STATUS_ARTICLE_42,
                    row_type="paragraph",
                    suffix="article-0042-source-gap-repair",
                )
            )
            repaired_rows.extend(
                _build_source_gap_row(
                    template=row,
                    text=repair_text,
                    row_type=row_type,
                    suffix=f"source-gap-repair-{index:02d}",
                )
                for index, (row_type, repair_text) in enumerate(
                    _STUDENT_STATUS_SOURCE_GAP_ROWS,
                    start=1,
                )
            )
            repaired = True
            continue
        repaired_rows.append(row)
    return repaired_rows


def _build_source_gap_row(
    *,
    template: dict[str, object],
    text: str,
    row_type: str,
    suffix: str,
) -> dict[str, object]:
    row = dict(template)
    row["row_id"] = f"{template.get('row_id')}-{suffix}"
    row["row_type"] = row_type
    row["block_role"] = "heading" if row_type == "heading" else row_type
    row["heading_level"] = 1 if row_type == "heading" else None
    row["text_raw"] = text
    row["text_normalized"] = text
    row["section_hint"] = text if row_type == "heading" else None
    row["is_repeated_candidate"] = False
    row["classification_confidence"] = 1.0
    row["classification_reason"] = f"source_gap_repair:{_STUDENT_STATUS_SOURCE_REPAIR_URL}"
    return row


__all__ = ["repair_projected_content_rows"]
