from __future__ import annotations

SURFACE_QRELS_FIXTURES = {
    "regulations/student_rules": "student_handbook_retrieval_qrels.json",
    "regulations/institutional_rules": "institutional_rules_retrieval_qrels.json",
    "curriculum/curriculum_plan": "curriculum_plan_retrieval_qrels.json",
    "official_web/stable_reference": "official_web_stable_reference_retrieval_qrels.json",
}

PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS = {
    "regulations/student_rules": (
        "policy-title-scholarship",
        "policy-alias-national-scholarship-article-nine",
        "semantic-scholarship-eligibility",
        "short-fact-attendance-discipline-threshold",
        "semantic-disciplinary-relief",
        "policy-title-recommend-postgraduate-exemption",
        "semantic-study-abroad-management",
        "semantic-innovation-education-credit",
        "policy-title-temporary-hardship-subsidy",
        "policy-title-national-grant",
        "policy-title-student-aid-management",
        "policy-title-funded-student-public-service",
    ),
    "regulations/institutional_rules": (
        "institutional-three-assists",
        "institutional-title-exact-ff711d1185f9",
        "institutional-title-exact-81401d3a02d6",
        "institutional-title-exact-7da72ac3d796",
        "institutional-title-exact-40d4d65809c5",
        "institutional-title-exact-e593d7a51e16",
        "institutional-title-exact-ccd8fad3cd06",
        "institutional-title-exact-580644ffc701",
        "institutional-title-exact-6ad2032144d0",
        "institutional-title-exact-a7716c82cbe1",
        "institutional-title-exact-eb3f2445780f",
        "institutional-title-exact-3c69a0dd5d82",
        "institutional-title-exact-f2860d036974",
    ),
    "curriculum/curriculum_plan": (
        "ethnology-plan-title",
        "history-strong-base-title",
        "digital-economy-plan-paraphrase",
        "ethnology-second-degree-academic-years",
        "ethnology-total-credits",
        "economics-course-settings-table",
        "general-english-total-credits",
        "hanyu-international-students-total-credits",
        "law-ethnic-class-fourth-semester-courses",
        "semantic-philosophy-strong-base-paraphrase",
        "curriculum-title-general-chinese-culture",
        "curriculum-title-social-practice",
    ),
    "official_web/stable_reference": (
        "stable-reference-school-profile",
        "stable-reference-teaching-research-units",
        "stable-reference-fee-disclosure",
        "stable-reference-no-hit-fictional-service",
    ),
}

RAGAS_DIAGNOSTIC_CASE_METRIC_OVERRIDES = {
    "policy-title-scholarship": {"answer_relevancy": False},
    "institutional-three-assists": {"answer_relevancy": False},
    "institutional-title-exact-81401d3a02d6": {"answer_relevancy": False},
    "ethnology-plan-title": {"answer_relevancy": False},
    "stable-reference-school-profile": {"answer_relevancy": False},
    "stable-reference-teaching-research-units": {"answer_relevancy": False},
    "stable-reference-fee-disclosure": {"answer_relevancy": False},
}

__all__ = [
    "PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS",
    "SURFACE_QRELS_FIXTURES",
]
