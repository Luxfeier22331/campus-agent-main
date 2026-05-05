from __future__ import annotations

import re

_CLAUSE_SPLIT_RE = re.compile(r"[。；;！!？?\n]+")
_QUOTED_TITLE_RE = re.compile(r"《([^》]{2,40})》")
_TIME_CLAIM_RE = re.compile(
    r"((?:\d{1,4}|[一二三四五六七八九十两零〇]+)(?:个)?(?:工作日|日|天|周|星期|个月|月|年|小时|分钟))"
)
_QUANTITY_CLAIM_RE = re.compile(
    r"((?:\d+(?:\.\d+)?|[一二三四五六七八九十两零〇]+)(?:\s*)?(?:学分|学时|周学时|门|次|项|分|绩点))"
)
_SEMESTER_OR_TERM_RE = re.compile(
    r"((?:第(?:\d+|[一二三四五六七八九十两零〇]+)学期|第(?:\d+|[一二三四五六七八九十两零〇]+)学年|"
    r"(?:大一|大二|大三|大四|研一|研二|研三)(?:上|下)?|(?:春季|秋季|夏季|冬季)学期))"
)
_MATERIAL_DIRECT_RE = re.compile(
    r"(身份证原件|身份证复印件|学生证原件|学生证复印件|书面申请|申请表|证明材料|申请材料|相关材料|证明|原件|复印件)"
)
_MATERIAL_ACTION_RE = re.compile(
    r"(?:提交|填写|准备|提供|携带)"
    r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,16}"
    r"(?:申请表|书面申请|申请|原件|复印件|材料|证明|证件|身份证|学生证))"
)
_MATERIAL_LIST_RE = re.compile(
    r"(?:需要|需|应提交|须提交|提交|准备|提供|携带)"
    r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{2,48})"
)
_PROCEDURE_CLAIM_PATTERNS = (
    re.compile(r"(学院审核|部门审核|审核|审批|备案|盖章|挂失|报到|选课|缴费|注册)"),
)
_ELIGIBILITY_CLAIM_PATTERNS = (
    re.compile(
        r"(?:仅限|限|要求|需满足|须满足|必须为|仅面向)"
        r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{1,32}"
        r"(?:学生|专业|班|人员|身份|资格|条件))"
    ),
    re.compile(
        r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{1,32}"
        r"(?:学生|专业|班|人员|身份|资格|条件))"
        r"(?:方可|才能|才可|可以)办理"
    ),
)
_OFFERING_UNIT_NAME_RE = re.compile(
    r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,20}(?:学院|系|部|中心|教研室|研究院))"
)
_OFFERING_UNIT_PREFIX_CUES = ("由", "是", "开设单位", "开课单位", "开课学院", "负责单位")
_OFFERING_UNIT_SUFFIX_CUES = ("开设", "开课", "开的", "负责")
_AUDIENCE_MAJOR_GROUP_RE = re.compile(
    r"((?:[\u4e00-\u9fffA-Za-z0-9]{1,16}专业(?:、|，|,|/|和|及|以及)?)+)"
)
_AUDIENCE_POPULATION_RE = re.compile(
    r"((?:所有|全体)?[\u4e00-\u9fffA-Za-z0-9]{0,24}"
    r"(?:本预科学生|本科生|研究生|学生|民族班|实验班|基地班))"
)
_AUDIENCE_CUE_TOKENS = (
    "要上",
    "应修",
    "需要修读",
    "需要上",
    "需修",
    "为必修",
    "应当修读",
    "必须修读",
    "应认真完成",
    "面向",
    "适用于",
    "适用对象为",
    "针对",
)
_FRESHNESS_SENSITIVE_STATUS_PATTERNS = (
    re.compile(
        r"((?:当前|目前|最新|最近|今日|今天|本周|近期|截至目前|截至今日)"
        r"[\u4e00-\u9fffA-Za-z0-9（）()]{0,20}"
        r"(?:开放|关闭|更新|发布|有效|可用|上线|报名|通知|安排))"
    ),
)
_AUTHORIZATION_SENSITIVE_CLAIM_PATTERNS = (
    re.compile(
        r"((?:仅限|只对|仅对|需登录|需要登录|须登录|认证后|授权后|校内身份|校内用户)"
        r"[\u4e00-\u9fffA-Za-z0-9（）()]{0,24}"
        r"(?:访问|查看|读取|办理|可见|开放)?)"
    ),
)
_LOW_SIGNAL_REQUIREMENT_PHRASES = frozenset(
    {
        "需要",
        "须",
        "应",
        "必须",
        "提交",
        "填写",
        "携带",
        "提供",
        "准备",
        "办理",
        "审核",
    }
)
_AUDIENCE_SPLIT_RE = re.compile(r"(?:、|，|,|/|以及|及|和)")


__all__ = [
    "_AUDIENCE_CUE_TOKENS",
    "_AUDIENCE_MAJOR_GROUP_RE",
    "_AUDIENCE_POPULATION_RE",
    "_AUDIENCE_SPLIT_RE",
    "_AUTHORIZATION_SENSITIVE_CLAIM_PATTERNS",
    "_CLAUSE_SPLIT_RE",
    "_ELIGIBILITY_CLAIM_PATTERNS",
    "_FRESHNESS_SENSITIVE_STATUS_PATTERNS",
    "_LOW_SIGNAL_REQUIREMENT_PHRASES",
    "_MATERIAL_ACTION_RE",
    "_MATERIAL_DIRECT_RE",
    "_MATERIAL_LIST_RE",
    "_OFFERING_UNIT_NAME_RE",
    "_OFFERING_UNIT_PREFIX_CUES",
    "_OFFERING_UNIT_SUFFIX_CUES",
    "_PROCEDURE_CLAIM_PATTERNS",
    "_QUANTITY_CLAIM_RE",
    "_QUOTED_TITLE_RE",
    "_SEMESTER_OR_TERM_RE",
    "_TIME_CLAIM_RE",
]
