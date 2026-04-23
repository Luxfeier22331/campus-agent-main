from __future__ import annotations

import re
from dataclasses import dataclass

ARTICLE_PREFIX_RE = re.compile(
    r"^(?P<label>第\s*[0-9一二三四五六七八九十百千万〇零两]+\s*条)\s*(?P<rest>.*)$"
)
POLICY_DOC_NO_RE = re.compile(r"^[^\n]{0,40}(?:〔|\[)\d{4}(?:〕|\])\d+号$")
TITLE_VARIANT_SUFFIX_RE = re.compile(r"(?:[(（](?:修订|试行|暂行)[)）]|修订|试行|暂行)$")
LIST_ENTRY_PHONE_RE = re.compile(r"\d{5,}")
LIST_ENTRY_TWO_FIELD_RE = re.compile(r"^[^\s，。；：！？]{1,24}\s+[^\s，。；：！？]{1,24}$")
INLINE_ENUMERATED_PROVISION_RE = re.compile(r"^[一二三四五六七八九十百千万〇零两]+、.+[。；！？]$")
INLINE_ENUMERATED_HEADING_RE = re.compile(r"^[一二三四五六七八九十百千万〇零两]+、.+$")
INLINE_ENUMERATED_LABEL_RE = re.compile(
    r"^(?P<label>[一二三四五六七八九十百千万〇零两]+)、(?P<body>.+)$"
)
TOP_LEVEL_ENUMERATED_RE = re.compile(
    r"^(?:[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十百千万〇零两]+、)"
)
INLINE_LIST_MARKER_RE = re.compile(
    r"^(?P<label>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]))\s*(?P<body>.+)$"
)
ATTACHMENT_INLINE_LABEL_RE = re.compile(
    r"^(?P<label>(?:[0-9]+|[一二三四五六七八九十百千万〇零两]+)[:：])\s*(?P<body>.+)$"
)
INLINE_OCR_REFERENCE_MARKER_RE = re.compile(
    r"(?:(?<=^)|(?<=[\u4e00-\u9fff0-9,，;；:：、()（）]))\[(?:0|[1-9]\d?)\](?=$|[\u4e00-\u9fffA-Za-z0-9(（])"
)
STRUCTURAL_LINE_RE = re.compile(
    r"^(?:第\s*[0-9一二三四五六七八九十百千万〇零两]+\s*条|第[一二三四五六七八九十百千万〇零两0-9]+部分|"
    r"第[一二三四五六七八九十百千万〇零两]+[章节编]|[一二三四五六七八九十百千万〇零两]+、|"
    r"[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[0-9]+[.、])"
)
DATE_LINE_RE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日$")
LIST_SECTION_RANK = 7
POLICY_LEAF_SECTION_RANK = LIST_SECTION_RANK + 1
PHONE_HEADER_LABELS = {"单位名称", "电话号码"}
PHONE_GROUP_HEADINGS = (
    "校级办公与公共服务",
    "学生事务与安保服务",
    "就业工作处",
    "后勤产业集团",
)
PHONE_GROUP_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "学生事务与安保服务",
        (
            "学生处",
            "学生管理科",
            "思想政治教育科",
            "助学服务中心",
            "心理健康教育与咨询中心",
            "保卫武装部",
            "治安科",
            "户籍科",
            "安全消防科",
            "东校门",
            "西校门",
        ),
    ),
    ("就业工作处", ("就业指导", "就业信息管理", "就业市场管理")),
    (
        "后勤产业集团",
        ("公寓管理部", "餐饮服务部", "电工班", "锅炉班", "维修班", "水工班", "电梯班"),
    ),
)
CLOSING_SECTION_KEYWORDS = ("附则", "说明", "实施细则", "补充规定")
TERMINAL_PROVISION_KEYWORDS = (
    "负责解释",
    "负责施行",
    "自发布之日起实施",
    "自发布之日起施行",
    "自印发之日起实施",
    "自印发之日起施行",
    "自公布之日起实施",
    "自公布之日起施行",
    "自发布之日起执行",
    "另行通知",
    "同时废止",
)
DATED_EFFECTIVE_CLAUSE_RE = re.compile(
    r"^(?:本办法|本规定|本细则|本制度|本通知).{0,24}自\d{4}年\d{1,2}月\d{1,2}日起(?:开始)?(?:实施|施行|执行)[。；]?$"
)
GENERIC_TABLE_PROJECT_LABEL = "项目"
FORM_TABLE_CAPTION_KEYWORDS = ("申请表", "审批表", "登记表", "备案表", "信息表")
FORM_TABLE_FIELD_KEYWORDS = (
    "本人情况",
    "学生本人基本情况",
    "家庭经济情况",
    "家庭经济详细情况",
    "家庭住址",
    "身份证号码",
    "政治面貌",
    "出生年月",
    "入学时间",
    "农行卡号",
    "邮政编码",
    "家庭户口",
    "人均月收入",
    "收入来源",
    "工作单位及职务",
    "火车到站站名",
    "民主评议",
    "推荐档次",
    "认定决定",
    "认定结果",
    "户口类型",
    "认定理由",
    "学生陈述申请认定理由",
    "本人联系电话",
    "家庭人均年收入",
)
FORM_TABLE_SECTION_KEYWORDS = (
    "学生本人基本情况",
    "家庭经济情况",
    "学生陈述申请认定理由",
    "民主评议",
    "认定决定",
    "认定结果",
    "报送日期",
    "本人联系电话",
    "家庭经济详细情况",
)
FORM_TABLE_SIGNATURE_KEYWORDS = ("签字", "签章", "盖章", "报送日期", "联系电话")
FORM_TABLE_CHECKBOX_MARKERS = ("☐", "□", "■", "✓", "√")
TABLE_CONTEXT_INTRO_PHRASES = (
    "按以下方式",
    "按下列方式",
    "按下列标准",
    "如下表",
    "见下表",
    "具体如下",
    "对应关系",
)
DECORATIVE_TABLE_KEYWORDS = (
    "照片",
    "骑缝章",
    "盖章",
    "签字",
    "签章",
)
SHORT_HEADING_BODY_STARTERS = (
    "中央民族大学",
    "学生需要",
    "参加",
    "学校",
    "学生",
    "对退役",
    "无",
)
SHORT_HEADING_FORBIDDEN_FRAGMENTS = (
    "在",
    "由",
    "按",
    "根据",
    "按照",
    "可以",
    "必须",
    "应当",
    "不得",
    "负责",
    "组织",
    "进行",
    "提交",
    "完成",
    "办理",
    "取得",
    "录入",
    "审核",
    "确定",
    "通知",
    "采用",
    "掌握",
    "遵守",
    "受到",
)
SHORT_HEADING_PREFIX_RE = re.compile(r"^[\u4e00-\u9fff、与及和\-]{2,12}$")
CITATION_CONTINUATION_START_CHARS = {"[", "〔", "(", "（", "《", "“", "‘", '"', "'"}
SHORT_HEADING_WHITELIST = {
    "候选人公示",
    "学生申请",
    "毕业、结业与肄业",
    "报名审核",
    "公示",
}
SHORT_HEADING_SEMANTIC_SUFFIXES = (
    "申请",
    "审核",
    "初评",
    "公示",
    "报名",
    "认定",
    "考核",
    "名单",
    "方式",
    "要求",
    "条件",
    "原则",
    "标准",
    "程序",
    "步骤",
    "时间",
    "结果",
    "办法",
    "流程",
    "管理",
    "处理",
    "分配",
    "实施",
    "说明",
    "理由",
    "意见",
    "助学",
    "奖学金",
    "助学金",
    "减免",
    "代偿",
    "留学",
    "注册",
    "资助",
    "服务",
    "选拔",
    "通知",
)
NOTE_LINE_PREFIXES = ("备注:", "备注：", "注:", "注：")
BODY_SENTENCE_STARTERS = (
    "一般",
    "兹证明",
    "原则",
    "学生",
    "各院系",
    "学校",
    "用于",
    "应征",
    "院系",
    "教务处",
    "学院",
    "根据",
    "按照",
    "自愿",
    "符合",
    "申请",
    "应当",
    "可以",
    "不得",
    "负责",
    "组织",
    "进行",
    "完成",
    "办理",
    "确定",
    "公布",
    "公示",
)
DOC_NO_PARENTHESES_REPAIR_RE = re.compile(
    r"(?P<open>[(（])"
    r"(?P<body>[^()（）\n]{0,120}?"
    r"(?:民大校发|民大学发|民大党发|中发|教高)[^()（）\n]{0,40}?号)"
    r"(?P<suffix>[的并和及，。；、])"
)
APPENDIX_MARKERS = ("附件", "附表", "附录")
SOFT_WRAP_CONTINUATION_CHARS = frozenset({"、", "，", ","})
APPENDIX_INLINE_TITLE_SUFFIXES = ("证明", "申请表", "审批表", "登记表", "备案表", "信息表")
ATTACHMENT_TITLE_SUFFIXES = (
    "申请表",
    "审批表",
    "登记表",
    "备案表",
    "信息表",
    "统计表",
    "调查表",
    "汇总表",
    "明细表",
    "报表",
)
NAVIGATION_SECTION_KEYWORDS = ("流程", "程序", "步骤")
ANCILLARY_NOTE_SUFFIXES = ("制表",)
NAVIGATION_LEAF_FORBIDDEN_FRAGMENTS = (
    "应当",
    "不得",
    "可以",
    "必须",
    "负责",
    "根据",
    "按照",
)
LEAF_SECTION_PUNCTUATION_RE = re.compile(r"[，,。；;：:！？!?]")
RUNNING_HEADER_LINES = frozenset({"学生手册"})
FORM_COVER_KEYWORDS = (*ATTACHMENT_TITLE_SUFFIXES, "报送时间")


@dataclass(frozen=True, slots=True)
class HandbookCleanupResult:
    title: str
    doc_id: str
    version_id: str
    metadata: dict[str, object]
    canonical_markdown: str
    document_units: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class NormalizedHandbookTable:
    matrix: tuple[tuple[str, ...], ...]
    header_rows: tuple[tuple[str, ...], ...]
    body_rows: tuple[tuple[str, ...], ...]
    column_paths: tuple[str, ...]
    header_line: str
    row_lines: tuple[str, ...]
    caption_lines: tuple[str, ...]
    note_lines: tuple[str, ...]
