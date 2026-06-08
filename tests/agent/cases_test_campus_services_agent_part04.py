# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.test_campus_services_agent_support import *


class CampusServicesAgentTestPart04(unittest.TestCase):
    def test_http_query_service_decodes_service_guide_materials_and_fail_close_reason(
        self,
    ) -> None:
        material_transport = RecordingQueryHTTPTransport(
            {
                "service_query": "公费医疗报销需要什么材料",
                "guide_focus": "required_materials",
                "outcome": "resolved_current",
                "resolved_service": {
                    "service_id": "service:handbook:student-public-medical-reimbursement",
                    "display_name": "公费医疗报销办理指南",
                    "aliases": ["公费医疗报销"],
                    "category": "student_public_medical",
                    "campus_scope": "all",
                    "audience": ["student"],
                },
                "required_materials": [
                    {
                        "name": "急诊证明",
                        "required": True,
                        "note": "急病报销需提供。",
                        "source_refs": ["handbook:student_rules:pages:259-260#page=259"],
                    },
                    {
                        "name": "住院收据",
                        "required": True,
                        "note": "住院报销需提供。",
                        "source_refs": ["handbook:student_rules:pages:259-260#page=259"],
                    },
                ],
                "source_refs": ["handbook:student_rules:pages:259-260#page=259"],
                "matched_service_category": "student_public_medical",
            }
        )
        material_query_service = CampusServicesHTTPQueryService(
            base_url="http://execution-control.internal",
            shared_secret="query-secret",
            transport=material_transport,
        )

        material_result = material_query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=ServiceGuideLookupPayload(
                    service_query="公费医疗报销需要什么材料",
                    guide_focus="required_materials",
                )
            )
        )

        self.assertEqual(material_result.required_materials[0].name, "急诊证明")
        self.assertEqual(material_result.required_materials[1].name, "住院收据")
        self.assertEqual(material_result.matched_service_category, "student_public_medical")

        fail_close_transport = RecordingQueryHTTPTransport(
            {
                "service_query": "公费医疗报销联系电话是多少",
                "guide_focus": "contact",
                "outcome": "temporarily_unverifiable",
                "queried_time_anchor": "2026-04-26T10:30:00+08:00",
                "fail_close_reason": "field_not_provided_by_source",
                "field_status": {"contact": "source_not_provided"},
            }
        )
        fail_close_query_service = CampusServicesHTTPQueryService(
            base_url="http://execution-control.internal",
            shared_secret="query-secret",
            transport=fail_close_transport,
        )

        fail_close_result = fail_close_query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=ServiceGuideLookupPayload(
                    service_query="公费医疗报销联系电话是多少",
                    guide_focus="contact",
                )
            )
        )

        self.assertEqual(fail_close_result.outcome, "temporarily_unverifiable")
        self.assertEqual(fail_close_result.fail_close_reason, "field_not_provided_by_source")
        self.assertEqual(fail_close_result.field_status, {"contact": "source_not_provided"})


if __name__ == "__main__":
    unittest.main()
