from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.public_chat_entry_e2e import (
    PublicChatEntryObservation,
    evaluate_public_chat_entry_cases,
    load_public_chat_entry_cases,
    run_public_chat_entry_e2e_profile,
)


class PublicChatEntryE2ESuite(unittest.TestCase):
    def test_public_entry_evaluator_requires_source_url_and_cards_when_expected(self) -> None:
        case_set = load_public_chat_entry_cases()
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("public-entry-academic-calendar-date-week", case_ids)
        self.assertIn("public-entry-academic-calendar-named-event", case_ids)
        self.assertIn("public-entry-academic-calendar-spring-break-colloquial", case_ids)
        self.assertIn("public-entry-academic-calendar-notice-rest-day-override", case_ids)
        self.assertIn("public-entry-notice-spring-break-original", case_ids)
        case = case_set.cases[0]

        report = evaluate_public_chat_entry_cases(
            case_set.cases,
            {
                case.case_id: PublicChatEntryObservation(
                    case_id=case.case_id,
                    request_id="req_1",
                    trace_id="trace_1",
                    terminal_outcome=case.expected_terminal_outcome,
                    response_contract={"answer_text_present": True},
                    request_path="/api/chat/requests",
                )
            },
        )

        result = report.results[0]
        self.assertFalse(result.passed)
        self.assertEqual(result.failure_class, "response_contract_mismatch")

    def test_public_entry_evaluator_requires_answer_contract_for_calendar_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            cases_path = root / "cases.json"
            cases_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "public_chat_entry_e2e.v1",
                        "cases": [
                            {
                                "case_id": "public-entry-academic-calendar-spring-break-colloquial",
                                "user_goal": "今年春假是什么时候",
                                "split": "release_gate",
                                "expected_terminal_outcome": "completed",
                                "expected_response_contract": {
                                    "answer_text_present": True,
                                    "source_url_present": True,
                                    "cards_present": False,
                                },
                                "expected_answer_contract": {
                                    "must_contain": [
                                        "如果你说的“春假”是指这段校内连续不上课时间",
                                        "4 月 27 日到 5 月 5 日",
                                    ],
                                    "must_not_contain": ["口语说法", "官方表述", "大家常说"],
                                },
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            case_set = load_public_chat_entry_cases(cases_path)

        case = case_set.cases[0]
        report = evaluate_public_chat_entry_cases(
            case_set.cases,
            {
                case.case_id: PublicChatEntryObservation(
                    case_id=case.case_id,
                    request_id="req_1",
                    trace_id="trace_1",
                    terminal_outcome=case.expected_terminal_outcome,
                    response_contract=case.expected_response_contract,
                    answer_text="2026 年春假安排见通知。",
                    request_path="/api/chat/requests",
                )
            },
        )

        result = report.results[0]
        self.assertFalse(result.passed)
        self.assertEqual(result.failure_class, "answer_contract_mismatch")

    def test_profile_writes_public_entry_artifact_from_observations(self) -> None:
        case_set = load_public_chat_entry_cases()
        answer_texts = {
            "public-entry-campus-card-loss-guide": "校园卡遗失后可在自助补卡机补卡，并参考卡务中心地址办理。",
            "public-entry-academic-calendar-guide-entry": (
                "校历查看入口：https://www.muc.edu.cn/ggfw/mdxl.htm。"
            ),
            "public-entry-public-medical-materials": "公费医疗报销所需材料包括急诊证明、住院收据。",
            "public-entry-vpn-login-entry": "VPN 登录入口：https://vpn.muc.edu.cn。",
            "public-entry-academic-calendar-date-week": "2026-05-07是第10教学周。",
            "public-entry-academic-calendar-named-event": (
                "劳动节假期是5 月 1 日到 5 月 5 日，共 5 天；"
                "如果你说的“春假”是指这段校内连续不上课时间，对应的是4 月 27 日到 5 月 5 日。"
            ),
            "public-entry-academic-calendar-spring-break-colloquial": (
                "如果你说的“春假”是指这段校内连续不上课时间，对应的是4 月 27 日到 5 月 5 日；"
                "本（预）科生、研究生课程停课。"
            ),
            "public-entry-academic-calendar-notice-rest-day-override": "5 月 9 日不上课，当天按休息日安排。",
            "public-entry-notice-spring-break-original": "已找到春假通知原文链接。",
            "public-entry-notice-title-url": "已整理最近班车调整通知标题和链接。",
        }
        observations = {
            case.case_id: {
                "request_id": f"req_{case.case_id}",
                "trace_id": f"trace_{case.case_id}",
                "terminal_outcome": case.expected_terminal_outcome,
                "response_contract": case.expected_response_contract,
                "answer_text": answer_texts[case.case_id],
                "request_path": "/api/chat/requests",
            }
            for case in case_set.cases
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps({"observations": observations}, ensure_ascii=False),
                encoding="utf-8",
            )
            report = run_public_chat_entry_e2e_profile(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["profile_id"], "public_chat_entry_e2e")
        self.assertEqual(payload["summary"]["failed"], 0)
        self.assertEqual(payload["sanitized_results"][0]["reason"], "ok")


if __name__ == "__main__":
    unittest.main()
