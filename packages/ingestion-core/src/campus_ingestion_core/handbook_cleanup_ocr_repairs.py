from __future__ import annotations

import re
import unicodedata

from campus_ingestion_core.handbook_cleanup_shared import (
    DOC_NO_PARENTHESES_REPAIR_RE,
    INLINE_OCR_REFERENCE_MARKER_RE,
)

_INLINE_PERCENT_MATH_RE = re.compile(r"\$\s*(?P<value>\d+(?:\.\d+)?)\s*\\?%\s*\$")
_INLINE_RIGHT_ARROW_MATH_RE = re.compile(r"\$\s*\\rightarrow\s*\$")


def _normalize_body_fragment(value: str) -> str:
    return unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _has_unclosed_citation_context(text: str) -> bool:
    pairs = (
        ("(", ")"),
        ("（", "）"),
        ("《", "》"),
        ("[", "]"),
        ("〔", "〕"),
        ("“", "”"),
        ("‘", "’"),
    )
    return any(text.count(left) > text.count(right) for left, right in pairs)


def _repair_missing_parenthetical_doc_no_closure(text: str) -> str:
    repaired_lines: list[str] = []
    for raw_line in _normalize_body_fragment(text).splitlines():
        normalized = " ".join(raw_line.split()).strip()
        if not normalized or not _has_unclosed_citation_context(normalized):
            repaired_lines.append(normalized)
            continue
        repaired = normalized
        while True:
            match = DOC_NO_PARENTHESES_REPAIR_RE.search(repaired)
            if match is None:
                break
            closing = ")" if match.group("open") == "(" else "）"
            repaired = (
                f"{repaired[: match.start('suffix')]}{closing}{repaired[match.start('suffix') :]}"
            )
            if not _has_unclosed_citation_context(repaired):
                break
        repaired_lines.append(repaired)
    return "\n".join(line for line in repaired_lines if line)


def _repair_known_ocr_phrase_errors(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    normalized = _strip_inline_ocr_reference_markers(normalized)
    normalized = normalized.replace("允许使用永恒的所有电器", "允许使用的所有电器")
    normalized = normalized.replace("私自将违规电器带入室内着", "私自将违规电器带入室内者")
    normalized = normalized.replace("一法追究法律责任", "依法追究法律责任")
    normalized = normalized.replace("2.6月1日至9月30日", "2. 6月1日至9月30日")
    if normalized == "1. 国家法定节假日不统一熄灯。":
        normalized = "3. 国家法定节假日不统一熄灯。"
    normalized = normalized.replace("总和测评分", "综合测评分")
    normalized = normalized.replace("给与相应的处理", "给予相应的处理")
    normalized = normalized.replace("志愿志愿服务", "志愿服务")
    normalized = normalized.replace("教学和生活程序", "教学和生活秩序")
    normalized = normalized.replace("有关规定部分定安置", "有关规定安置")
    normalized = normalized.replace("事业职业死亡丧葬", "事业职工死亡丧葬")
    normalized = normalized.replace("财务被盗", "财物被盗")
    normalized = normalized.replace("本人本人违法", "本人违法")
    normalized = normalized.replace("调查人行使", "调查人员行使")
    normalized = normalized.replace("助学服务中心中心", "助学服务中心")
    normalized = normalized.replace("有人围学生", "有入围学生")
    normalized = normalized.replace("境外等级 成绩", "境外等级成绩")
    normalized = normalized.replace("校内百分 制成绩", "校内百分制成绩")
    normalized = normalized.replace("境外 5 分制", "境外5分制")
    normalized = normalized.replace(
        "申请受理申请国家助学贷款学生需",
        "申请受理\n申请国家助学贷款学生需",
    )
    normalized = normalized.replace(
        "申请审查国家助学贷款由",
        "申请审查\n国家助学贷款由",
    )
    normalized = normalized.replace("然由借款学生", "然后由借款学生")
    normalized = re.sub(
        r"\(二\)注册机构对申请材料进行审核[。．.]*",
        "(二)注册机构对申请材料进行审核。",
        normalized,
    )
    normalized = normalized.replace(
        "(七)临时困难补助学生在校学习期间",
        "(七)临时困难补助\n学生在校学习期间",
    )
    normalized = normalized.replace(
        "(八)绿色通道学校在每学年新生入学时",
        "(八)绿色通道\n学校在每学年新生入学时",
    )
    normalized = re.sub(
        r"家庭经济困难学生的勤工助学岗位聘用率,原则上应不低于 \$70\\%\$[。．…]*",
        "家庭经济困难学生的勤工助学岗位聘用率,原则上应不低于 70%。",
        normalized,
    )
    normalized = re.sub(
        r"主要适用于对于只涉及\s*(\d+)\s*个学院",
        r"主要适用于只涉及\1个学院",
        normalized,
    )
    normalized = re.sub(
        r"(?<!。)(1\.\s*面试主要考核申请者的口语表达能力和综合素质)$",
        r"\1。",
        normalized,
    )
    normalized = normalized.replace("争创先十佳大学生", "争创十佳大学生")
    return _normalize_inline_math_artifacts(normalized)


def _normalize_inline_math_artifacts(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    normalized = _INLINE_PERCENT_MATH_RE.sub(r"\g<value>%", normalized)
    normalized = _INLINE_RIGHT_ARROW_MATH_RE.sub("→", normalized)
    return re.sub(r"(?<=\d%)\s+(?=[,，。；;])", "", normalized)


def _strip_inline_ocr_reference_markers(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    return INLINE_OCR_REFERENCE_MARKER_RE.sub("", normalized)


__all__ = [
    "_repair_known_ocr_phrase_errors",
    "_repair_missing_parenthetical_doc_no_closure",
]
