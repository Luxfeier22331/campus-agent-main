from __future__ import annotations

import re

from campus_ingestion_core.curriculum_provider_text_table_repairs import (
    _normalize_table_body_header_cells,
    _repair_split_table_cell_continuations,
    _repair_table_category_rowspan_continuations,
)

_LIST_LIKE_LINE_RE = re.compile(
    r"^(?:[-*•]|[0-9]+[\.．、)]|[（(][一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、|第[一二三四五六七八九十百千万〇零0-9]+[章节])"
)
_FIELD_LABEL_LINE_RE = re.compile(
    r"^(?:备注|课程类|课程号|课程名称|学分|学时|实践学时|开设学期|修读学期)[:：]"
)
_MISSING_NUMERIC_LIST_DOT_RE = re.compile(
    r"(?m)^(?P<number>[1-9]\d?)(?P<body>[\u4e00-\u9fff][^:\n：]{0,24}[:：])"
)
_MISSING_NUMERIC_LIST_DOT_WITH_SPACE_RE = re.compile(
    r"(?m)^(?P<number>[1-9]\d?)\s+(?P<body>[\u4e00-\u9fff][^:\n：]{0,24}[:：])"
)
_SPACED_NUMERIC_RANGE_RE = re.compile(r"(?<=\d)-\s+(?=\d)")
_GLOBAL_COMPETENCE_PLACEHOLDER = "学校通开的全球胜任力培养课程"


def _repair_mineru_text_artifacts(text: str) -> str:
    repaired = _MISSING_NUMERIC_LIST_DOT_RE.sub(r"\g<number>. \g<body>", text)
    repaired = _MISSING_NUMERIC_LIST_DOT_WITH_SPACE_RE.sub(
        r"\g<number>. \g<body>",
        repaired,
    )
    repaired = repaired.replace("\\geq", "≥")
    repaired = repaired.replace("\\leq", "≤")
    repaired = _SPACED_NUMERIC_RANGE_RE.sub("-", repaired)
    repaired = re.sub(
        r"应修学分(?P<credits>\d+(?:\.\d+)?)学分",
        r"应修\g<credits>学分",
        repaired,
    )
    repaired = re.sub(
        r"(实践环节合计\d+(?:\.\d+)?学分,为必)$",
        r"\1修。",
        repaired,
    )
    repaired = repaired.replace("建议续深造学生选修", "建议继续深造学生选修")
    repaired = repaired.replace("马克主义", "马克思主义")
    repaired = repaired.replace("具备具有", "具备")
    repaired = repaired.replace("刑事司法治度", "刑事司法制度")
    repaired = repaired.replace("能能够", "能够")
    repaired = repaired.replace("笔试工作坊", "笔译工作坊")
    repaired = repaired.replace("课 程", "课程")
    repaired = repaired.replace("专业学生方向学生", "专业方向学生")
    repaired = repaired.replace("文学、博物馆学", "文物学、博物馆学")
    repaired = repaired.replace("文学学研究", "文物学研究")
    repaired = repaired.replace("文生物学研究", "文物学研究")
    repaired = repaired.replace(
        "<td>0651-2-05-01</td><td>文学研究</td>",
        "<td>0651-2-05-01</td><td>文物学研究</td>",
    )
    repaired = repaired.replace("文物理学概论", "文物学概论")
    repaired = repaired.replace("(三)要求能力", "(三)能力要求")
    repaired = repaired.replace(
        "了解国内外文博界重要动态具有进一步进行文物与博物馆研究的基础。",
        "了解国内外文博界重要动态,具有进一步进行文物与博物馆研究的基础。",
    )
    repaired = repaired.replace(
        (
            "立足北京,面向全国,着眼国际,主要培养政治素质过硬、人文底蕴"
            "秉承“立德启智、知行合一、文化融合、国际视野”的育人理念,深厚、国际视野宽广"
        ),
        (
            "立足北京,面向全国,着眼国际,秉承“立德启智、知行合一、文化融合、国际视野”的"
            "育人理念,主要培养政治素质过硬、人文底蕴深厚、国际视野宽广"
        ),
    )
    repaired = re.sub(
        (
            r"1\.\s*专业能力:应具备基本的经济分析能力,掌握经济学理论发展脉络,"
            r"具备经济学思维和使用经济学研究现实经济社会问题的能力,"
            r"熟练使用前沿数字技术开展经济研究点能力。数字经济专业应,具备"
        ),
        (
            "1. 专业能力:应具备基本的经济分析能力,掌握经济学理论发展脉络,"
            "具备经济学思维和使用经济学研究现实经济社会问题的能力,"
            "熟练使用前沿数字技术开展经济研究的能力。"
        ),
        repaired,
    )
    repaired = repaired.replace(
        "形成跨学科知识结构。\n构,能够进行跨学科思考。",
        "形成跨学科知识结构,能够进行跨学科思考。",
    )
    repaired = repaired.replace(
        "形成跨学科知识结构。\n构，能够进行跨学科思考。",
        "形成跨学科知识结构,能够进行跨学科思考。",
    )
    repaired = repaired.replace("全球胜任力培养客户", "全球胜任力培养课程")
    repaired = repaired.replace(">全球胜<", ">全球胜任力培养课程<")
    repaired = repaired.replace(">任力培养课程<", ">全球胜任力培养课程<")
    repaired = repaired.replace(
        f"{_GLOBAL_COMPETENCE_PLACEHOLDER}/",
        _GLOBAL_COMPETENCE_PLACEHOLDER,
    )
    repaired = repaired.replace(">建议拟出国学<", ">建议拟出国学生选修<")
    repaired = repaired.replace(">生选修<", ">建议拟出国学生选修<")
    repaired = repaired.replace("高光谱成像级应用", "高光谱成像及应用")
    repaired = _repair_personalized_study_guidance_intro(repaired)
    repaired = _repair_curriculum_summary_table_artifacts(repaired)
    repaired = _repair_global_competence_placeholder_row(repaired)
    repaired = _repair_global_competence_label_split(repaired)
    repaired = _repair_basic_literacy_label_split(repaired)
    repaired = _repair_industry_collaboration_label_split(repaired)
    repaired = _repair_university_math_table_artifacts(repaired)
    repaired = _repair_chinese_international_personalized_table_artifacts(repaired)
    repaired = _repair_public_management_table_artifacts(repaired)
    repaired = _repair_public_management_elective_intro(repaired)
    repaired = _repair_minority_preparatory_program_artifacts(repaired)
    repaired = _repair_ethnology_second_bachelor_table_artifact(repaired)
    repaired = _repair_paleography_program_table_artifacts(repaired)
    repaired = _repair_table_category_rowspan_continuations(repaired)
    repaired = _normalize_table_body_header_cells(repaired)
    repaired = _repair_split_table_cell_continuations(repaired)
    return _repair_biology_cross_course_table_artifact(repaired)


def _repair_personalized_study_guidance_intro(text: str) -> str:
    if "修读建议拟继续深造学生建议" not in text:
        return text
    return text.replace(
        "修读建议拟继续深造学生建议",
        "修读建议如下:拟继续深造学生建议",
    )


def _repair_curriculum_summary_table_artifacts(text: str) -> str:
    if "<table" not in text or "培养阶段" not in text:
        return text
    repaired = text
    repaired = re.sub(
        r"<tr><td>专业</td><td>专业教育</td><td>专业核心课</td>",
        "<tr><td>专业培养</td><td>专业教育</td><td>专业核心课</td>",
        repaired,
    )
    repaired = re.sub(
        r"<tr><td>培养</td><td></td><td>专业选修课</td>",
        "<tr><td>专业培养</td><td>专业教育</td><td>专业选修课</td>",
        repaired,
    )
    repaired = re.sub(
        r"<tr><td></td><td>学科基础教育</td><td>学科基础课</td>",
        "<tr><td>大类培养</td><td>学科基础教育</td><td>学科基础课</td>",
        repaired,
    )
    return _repair_design_summary_table_major_split(repaired)


def _repair_design_summary_table_major_split(text: str) -> str:
    if "服装与服饰设" not in text or "<table" not in text:
        return text
    repaired = text.replace(
        '<tr><td rowspan="7">专业培养</td><td rowspan="7">专业教育</td>',
        '<tr><td rowspan="8">专业培养</td><td rowspan="8">专业教育</td>',
    )
    return repaired.replace(
        (
            "<tr><td>服装与服饰设</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>"
            "<tr><td></td><td></td><td>计</td><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
        ),
        (
            '<tr><td rowspan="2">服装与服饰设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>'
            "<tr><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
        ),
    )


def _repair_global_competence_placeholder_row(text: str) -> str:
    if _GLOBAL_COMPETENCE_PLACEHOLDER not in text or "<table" not in text:
        return text

    placeholder_cell = rf"<td>{re.escape(_GLOBAL_COMPETENCE_PLACEHOLDER)}/?</td>"
    pattern = re.compile(
        rf"<tr><td>(?P<course_class>全球胜任力(?:培养)?课程)</td>"
        rf"(?P<fields>{placeholder_cell}(?:{placeholder_cell}){{5}})"
        rf"(?P<remark><td>[^<]*</td>)?</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        course_class = match.group("course_class")
        remark = match.group("remark") or ""
        return (
            f"<tr><td>{course_class}</td><td></td>"
            f"<td>{_GLOBAL_COMPETENCE_PLACEHOLDER}</td>"
            f"<td></td><td></td><td></td><td></td>{remark}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_biology_cross_course_table_artifact(text: str) -> str:
    if "1043040223" not in text or "1043040603" not in text:
        return text
    repaired = text.replace(
        '<td rowspan="2">跨学科交叉课程</td><td>1043040223</td>',
        '<td rowspan="3">跨学科交叉课程</td><td>1043040223</td>',
    )
    repaired = repaired.replace(
        '<td rowspan="2">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的</td>',
        '<td rowspan="3">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的其他课程。此模块建议所有学生选修至少2学分</td>',
    )
    return repaired.replace(
        "<tr><td></td><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td><td>其他课程。此模块建议所有学生选修至少2学分</td></tr>",
        "<tr><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td></tr>",
    )


def _repair_global_competence_label_split(text: str) -> str:
    if "<table" not in text:
        return text
    repaired = text
    split_cell_pattern = re.compile(
        r"<tr><td>全球胜任</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td\s+rowspan=\"(?P<rowspan>\d+)\">力培养课\s*程</td>"
        r"(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace_split_cell(match: re.Match[str]) -> str:
        rowspan = int(match.group("rowspan")) + 1
        return (
            f'<tr><td rowspan="{rowspan}">全球胜任力培养课程</td>'
            f"{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
        )

    repaired = split_cell_pattern.sub(replace_split_cell, repaired)
    if "全球胜任力培" not in repaired or "养课程" not in repaired:
        return repaired

    pattern = re.compile(
        r"<tr><td rowspan=\"2\">全球胜任力培</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr>(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td rowspan=\"2\">养课程</td>(?P<third_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr>(?P<fourth_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        return (
            '<tr><td rowspan="4">全球胜任力培养课程</td>'
            f"{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
            f"<tr>{match.group('third_rest')}</tr>"
            f"<tr>{match.group('fourth_rest')}</tr>"
        )

    return pattern.sub(replace, repaired)


def _repair_industry_collaboration_label_split(text: str) -> str:
    if "行业领域" not in text or "协同" not in text or "<table" not in text:
        return text
    text = re.sub(r">行业领域\s+协同育人\s+课程<", ">行业领域协同育人课程<", text)

    pattern = re.compile(
        r"<tr><td>行业领域</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td(?:\s+rowspan=\"(?P<rowspan>\d+)\")?>(?P<suffix>协同(?:育人)?课程)</td>"
        r"(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        rowspan = int(match.group("rowspan") or "1")
        suffix = match.group("suffix")
        combined = f"行业领域{suffix}"
        rowspan_attr = f' rowspan="{rowspan + 1}"' if rowspan + 1 > 1 else ""
        return (
            f"<tr><td{rowspan_attr}>{combined}</td>{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_basic_literacy_label_split(text: str) -> str:
    if "基本素" not in text or "养课" not in text or "<table" not in text:
        return text

    pattern = re.compile(
        r"<tr><td>基本素</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td rowspan=\"(?P<rowspan>\d+)\">养课</td>(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        rowspan = int(match.group("rowspan"))
        return (
            f'<tr><td rowspan="{rowspan + 1}">基本素养课</td>'
            f"{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_university_math_table_artifacts(text: str) -> str:
    if "大学数学(三)" not in text or "概率论与数理统计" not in text or "<table" not in text:
        return text
    repaired = text.replace(
        '<td rowspan="3">大学数学(三)</td>',
        '<td rowspan="4">大学数学(三)</td>',
    )
    repaired = repaired.replace(
        '<td rowspan="3">/</td></tr><tr><td>高等数学(三)下</td>',
        '<td rowspan="4">/</td></tr><tr><td>高等数学(三)下</td>',
    )
    return repaired.replace(
        "<tr><td></td><td>概率论与数理统计</td><td>3</td><td>54</td><td>3</td><td></td></tr>",
        "<tr><td>概率论与数理统计</td><td>3</td><td>54</td><td>3</td></tr>",
    )


def _repair_chinese_international_personalized_table_artifacts(text: str) -> str:
    if "0453-2-24-50" not in text or "本硕贯通课程" not in text or "<table" not in text:
        return text
    repaired = text.replace(
        '<tr><td rowspan="2">本硕贯通课程</td>',
        '<tr><td rowspan="11">本硕贯通课程</td>',
    )
    repaired = repaired.replace(
        '<td rowspan="2">模块一:\n文化传播类课程语</td>',
        '<td rowspan="2">模块一:文化传播类课程</td>',
    )
    return repaired.replace(
        '<tr><td rowspan="9"></td><td rowspan="6">模块二:汉语教学类课程</td>',
        '<tr><td rowspan="6">模块二:汉语教学类课程</td>',
    )


def _repair_public_management_table_artifacts(text: str) -> str:
    if (
        "2-4沟通与合作能够力" not in text
        and "3-3-1热忱对待公共管理事业" not in text
        and "2-4 沟通与合作能够力" not in text
    ):
        return text

    repaired = text.replace("2-4沟通与合作能够力", "2-4沟通与合作能力")
    repaired = repaired.replace("2-4 沟通与合作能够力", "2-4 沟通与合作能力")
    repaired = repaired.replace(
        "2-4-3能够初步地进行专业领域的国际交流",
        "2-4-3 能够初步地进行专业领域的国际交流",
    )
    repaired = repaired.replace(
        "2-5-3形成公共管理学专业所需的人文关怀和实践创新能力",
        "2-5-3 形成公共管理学专业所需的人文关怀和实践创新能力",
    )
    repaired = repaired.replace(
        "3-1-4具有维护民族团结和祖国统一的使命感和中华民族共同体意识",
        "3-1-4 具有维护民族团结和祖国统一的使命感和中华民族共同体意识",
    )
    repaired = repaired.replace(
        "3-2-3积极践行社会主义核心价值观", "3-2-3 积极践行社会主义核心价值观"
    )
    pattern = re.compile(
        r"<tr>(?P<prefix>(?:<td[^>]*>.*?</td>)?)<td>3-3职业素养</td>"
        r"<td>3-3-1\s*热忱对待公共管理事业,对国家与社会发展</td></tr>"
        r"<tr>(?:<td[^>]*>\s*</td>){1,2}<td>有责任心</td></tr>"
        r"<tr><td>3-3-2\s*乐于、甘于投身祖国的公共管理事业</td></tr>"
    )
    return pattern.sub(
        lambda match: (
            f'<tr>{match.group("prefix")}<td rowspan="2">3-3职业素养</td>'
            "<td>3-3-1 热忱对待公共管理事业,对国家与社会发展有责任心</td></tr>"
            "<tr><td>3-3-2 乐于、甘于投身祖国的公共管理事业</td></tr>"
        ),
        repaired,
    )


def _repair_public_management_elective_intro(text: str) -> str:
    if "选修列表中的所有课程,原则上两个专业学生均可选修。为区分专业" not in text:
        return text
    return text.replace(
        "选修列表中的所有课程,原则上两个专业学生均可选修。为区分专业",
        "选修列表中的所有课程,原则上两个专业学生均可选修。",
    )


def _repair_minority_preparatory_program_artifacts(text: str) -> str:
    repaired = text.replace(
        "文化引领为一体、根据教学内容和学生特点", "文化引领为一体,根据教学内容和学生特点"
    )
    repaired = repaired.replace(
        "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语",
        "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。",
    )
    repaired = repaired.replace(
        "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语基础课程:理科班增设普通化学和大学物理",
        "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。基础课程:理科班增设普通化学和大学物理。",
    )
    repaired = repaired.replace(
        "基础课程:理科班增设普通化学和大学物理",
        "基础课程:理科班增设普通化学和大学物理。",
    )

    summary_bad = (
        '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
        '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
        '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
        '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr>'
        '<tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>'
        '<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
        '<tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>'
    )
    summary_good = (
        '<table><tr><td colspan="5">文科班</td></tr><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
        '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
        '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
        '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td colspan="5">理科班</td></tr><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
        '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>'
        '<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>'
    )
    repaired = repaired.replace(summary_bad, summary_good)
    summary_table_start = (
        '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td>'
        '<td colspan="2">各学期周学时分配计划</td></tr>'
    )
    if (
        '<td colspan="5">文科班</td>' not in repaired
        and "<td>主干课</td><td>468</td>" in repaired
        and '<td colspan="2">合计</td><td>828</td>' in repaired
    ):
        repaired = repaired.replace(
            summary_table_start,
            '<table><tr><td colspan="5">文科班</td></tr>'
            '<tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td>'
            '<td colspan="2">各学期周学时分配计划</td></tr>',
            1,
        )
    if (
        '<td colspan="5">理科班</td>' not in repaired
        and "<td>主干课</td><td>540</td>" in repaired
        and "<td>基础课</td><td>144</td>" in repaired
        and '<td colspan="2">合计</td><td>1044</td>' in repaired
    ):
        repaired = repaired.replace(
            summary_table_start,
            '<table><tr><td colspan="5">理科班</td></tr>'
            '<tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td>'
            '<td colspan="2">各学期周学时分配计划</td></tr>',
            1,
        )

    detail_bad = (
        '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
        '<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan="8">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan="8">必修</td></tr>'
        "<tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr><tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr>"
        '<tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr><tr><td rowspan="7">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan="7">必修</td></tr>'
        "<tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
        "<tr><td>1052030031</td><td>高等数学(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td></tr><tr><td>1052030032</td><td>高等数学(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr>"
        '<tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr><tr><td rowspan="3">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr>'
        "<tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辨正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        '<tr><td rowspan="3">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>'
        '<tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td rowspan="3">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan="3">选修:根据兴趣及需求选修,可多选</td></tr>'
        "<tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td></td><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
        "<tr><td></td><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
        "<tr><td></td><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr></table>"
    )
    detail_good = (
        '<table><tr><td colspan="9">文科班</td></tr><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
        '<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan="8">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan="8">必修</td></tr>'
        "<tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr><tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr>"
        '<tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr><tr><td rowspan="7">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan="7">必修</td></tr>'
        "<tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
        "<tr><td>1052030031</td><td>高等数学(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td></tr><tr><td>1052030032</td><td>高等数学(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr>"
        '<tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr><tr><td rowspan="3">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr>'
        "<tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辨正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        '<tr><td rowspan="3">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>'
        '<tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td rowspan="9">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan="9">选修:根据兴趣及需求选修,可多选</td></tr>'
        "<tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr>"
        "<tr><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr>"
        "<tr><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr></table>"
    )
    repaired = repaired.replace(detail_bad, detail_good)
    detail_second_table_start = (
        '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td>'
        '<td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td>'
        '<td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
    )
    detail_second_table_labeled = (
        '<table><tr><td colspan="9">理科班</td></tr><tr><td rowspan="2">课程类别</td>'
        '<td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td>'
        '<td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
    )
    return repaired.replace(detail_second_table_start, detail_second_table_labeled, 1)


def _repair_ethnology_second_bachelor_table_artifact(text: str) -> str:
    return text.replace(
        '<td rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td>',
        '<td rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>',
    )


def _repair_paleography_program_table_artifacts(text: str) -> str:
    if "全球胜任力培养</td>" not in text and "370</td><td>350</td><td>120" not in text:
        return text
    repaired = text.replace(">全球胜任力培养<", ">全球胜任力培养课程<")
    return repaired.replace(
        "<td>思政课</td><td>19</td><td>必修</td><td>370</td><td>350</td><td>120</td>",
        "<td>思政课</td><td>19</td><td>必修</td><td>370</td><td>250</td><td>120</td>",
    )


def _repair_sentence_wraps(lines: list[str]) -> str:
    if not lines:
        return ""
    repaired = lines[0]
    for line in lines[1:]:
        if _should_preserve_line_break(repaired, line):
            repaired = f"{repaired}\n{line}"
            continue
        repaired = f"{repaired}{_joiner_between(repaired, line)}{line}"
    return repaired


def _should_preserve_line_break(previous: str, current: str) -> bool:
    previous_tail = previous.rstrip()
    if not previous_tail:
        return False
    previous_line = previous_tail.rsplit("\n", maxsplit=1)[-1]
    if previous_tail.endswith(("。", "！", "？", "；", ":", "：")):
        return True
    if _FIELD_LABEL_LINE_RE.match(previous_line):
        return True
    if _FIELD_LABEL_LINE_RE.match(current):
        return True
    return bool(_LIST_LIKE_LINE_RE.match(current))


def _joiner_between(previous: str, current: str) -> str:
    previous_tail = previous.rstrip()
    current_head = current.lstrip()
    if not previous_tail or not current_head:
        return ""
    if (
        previous_tail[-1].isascii()
        and previous_tail[-1].isalnum()
        and current_head[0].isascii()
        and current_head[0].isalnum()
    ):
        return " "
    return ""


__all__ = [
    "_repair_ethnology_second_bachelor_table_artifact",
    "_repair_mineru_text_artifacts",
    "_repair_minority_preparatory_program_artifacts",
    "_repair_paleography_program_table_artifacts",
    "_repair_sentence_wraps",
]
