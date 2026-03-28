from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from scripts.public_consumer_chat_live_smoke import run_smoke, summarize_result


class _FakeHeaders:
    def __init__(self, values: dict[str, list[str] | str] | None = None) -> None:
        self._values = values or {}

    def get_all(self, name: str, default=None):
        value = self._values.get(name.lower(), default)
        if value is default:
            return default
        if isinstance(value, list):
            return value
        return [value]


class _FakeResponse:
    def __init__(self, body: dict[str, object], headers: _FakeHeaders | None = None) -> None:
        self._body = body
        self.headers = headers or _FakeHeaders()

    def read(self) -> bytes:
        import json

        return json.dumps(self._body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeOpener:
    def __init__(self) -> None:
        self.calls = []
        self._login_call_count = 0

    def open(self, request):
        self.calls.append(request)
        if request.full_url.endswith("/api/auth/sign-up/email"):
            self._login_call_count += 1
            if self._login_call_count == 1:
                return _FakeResponse({"error": "User already exists. Use another email."})
            return _FakeResponse({"error": "User already exists. Use another email."})
        if request.full_url.endswith("/api/auth/sign-in/email"):
            return _FakeResponse(
                {"ok": True},
                headers=_FakeHeaders(
                    {
                        "set-cookie": [
                            "better-auth.session_token=session-123; Path=/; HttpOnly; SameSite=Lax"
                        ]
                    }
                ),
            )
        if request.full_url.endswith("/api/conversations"):
            return _FakeResponse({"conversation": {"id": "conv-123"}})
        if request.full_url.endswith("/api/answer"):
            return _FakeResponse(
                {
                    "answer": {
                        "result": {
                            "kind": "answer",
                            "text": "ok",
                            "request_id": "trace-123",
                        }
                    }
                }
            )
        raise AssertionError(f"unexpected url: {request.full_url}")


class PublicConsumerChatLiveSmokeTest(unittest.TestCase):
    def test_summarize_result_prefers_result_text_and_request_id(self) -> None:
        summary = summarize_result(
            {
                "login": {"ok": True},
                "conversation": {"id": "conv-123"},
                "answer": {
                    "answer": {
                        "result": {
                            "kind": "answer",
                            "text": "The library closes at 22:00.",
                            "request_id": "trace-123",
                        }
                    }
                },
            }
        )

        self.assertEqual(summary["login_ok"], True)
        self.assertEqual(summary["conversation_id"], "conv-123")
        self.assertEqual(summary["answer_kind"], "answer")
        self.assertEqual(summary["message"], "The library closes at 22:00.")
        self.assertEqual(summary["correlation_id"], "trace-123")

    def test_summarize_result_falls_back_to_message_and_nested_conversation(self) -> None:
        summary = summarize_result(
            {
                "login": {"ok": True},
                "conversation": {"conversation": {"id": "conv-456"}},
                "answer": {
                    "answer": {
                        "result": {
                            "kind": "error",
                            "message": "No grounded answer is available yet.",
                        },
                        "conversation": {
                            "messages": [
                                {"role": "assistant", "requestId": "trace-456"},
                            ]
                        },
                    },
                },
            }
        )

        self.assertEqual(summary["conversation_id"], "conv-456")
        self.assertEqual(summary["answer_kind"], "error")
        self.assertEqual(summary["message"], "No grounded answer is available yet.")
        self.assertEqual(summary["correlation_id"], "trace-456")

    def test_run_smoke_forwards_login_cookie_to_authenticated_routes(self) -> None:
        opener = _FakeOpener()

        with patch("scripts.public_consumer_chat_live_smoke.build_opener", return_value=opener):
            payload = run_smoke(
                base_url="http://127.0.0.1:8788",
                email="smoke@example.com",
                password="password123",
                prompt="图书馆开放到几点？",
                name="Smoke Student",
                mode="sign-up",
            )

        self.assertEqual(payload["conversation"]["conversation"]["id"], "conv-123")
        self.assertEqual(payload["answer"]["answer"]["result"]["request_id"], "trace-123")

        self.assertEqual(len(opener.calls), 4)
        conversations_request = opener.calls[2]
        answer_request = opener.calls[3]
        self.assertEqual(
            conversations_request.get_header("Cookie"),
            "better-auth.session_token=session-123",
        )
        self.assertEqual(
            answer_request.get_header("Cookie"),
            "better-auth.session_token=session-123",
        )
        first_login_body = json.loads(opener.calls[0].data.decode("utf-8"))
        second_login_body = json.loads(opener.calls[1].data.decode("utf-8"))
        self.assertEqual(first_login_body["name"], "Smoke Student")
        self.assertEqual(first_login_body["email"], "smoke@example.com")
        self.assertEqual(second_login_body["email"], "smoke@example.com")


if __name__ == "__main__":
    unittest.main()
