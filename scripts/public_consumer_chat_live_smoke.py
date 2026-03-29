from __future__ import annotations

import argparse
import json
import os
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, build_opener


DEFAULT_BASE_URL = "http://127.0.0.1:3000"
DEFAULT_EMAIL = "smoke-student@example.com"
DEFAULT_PASSWORD = "password123"
DEFAULT_PROMPT = "图书馆开放到几点？"


def _post_json(opener, url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with opener.open(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body}
        raise RuntimeError(f"{exc.code} {url}: {json.dumps(parsed, ensure_ascii=False)}") from exc


def _build_cookie_header(set_cookie_headers: list[str] | None) -> str | None:
    if not set_cookie_headers:
        return None

    cookie_pairs: list[str] = []
    for header in set_cookie_headers:
        cookie_kv = header.split(";", 1)[0].strip()
        if cookie_kv:
            cookie_pairs.append(cookie_kv)

    if not cookie_pairs:
        return None
    return "; ".join(cookie_pairs)


def _login_with_fallback(
    opener,
    *,
    base_url: str,
    mode: str,
    name: str,
    email: str,
    password: str,
) -> tuple[dict[str, Any], str | None]:
    def attempt(login_mode: str) -> tuple[dict[str, Any], str | None]:
        auth_path = (
            "/api/auth/sign-up/email" if login_mode == "sign-up" else "/api/auth/sign-in/email"
        )
        login_request = Request(
            f"{base_url}{auth_path}",
            data=json.dumps(
                {
                    "name": name,
                    "email": email,
                    "password": password,
                }
            ).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with opener.open(login_request) as login_response:
            login_payload = json.loads(login_response.read().decode("utf-8"))
            cookie_header = _build_cookie_header(login_response.headers.get_all("set-cookie"))
        return login_payload, cookie_header

    login_payload, cookie_header = attempt(mode)
    if cookie_header:
        return login_payload, cookie_header

    if (
        mode == "sign-up"
        and isinstance(login_payload.get("error"), str)
        and "already exists" in login_payload["error"].lower()
    ):
        return attempt("sign-in")

    return login_payload, cookie_header


def _extract_conversation_id(payload: dict[str, Any]) -> str:
    direct = payload.get("id")
    if isinstance(direct, str) and direct:
        return direct

    conversation = payload.get("conversation")
    if isinstance(conversation, dict):
        nested = conversation.get("id")
        if isinstance(nested, str) and nested:
            return nested

    raise RuntimeError("conversation id missing from create-conversation payload")


def summarize_result(payload: dict[str, Any]) -> dict[str, Any]:
    login_payload = payload.get("login")
    conversation_payload = payload.get("conversation")
    answer_payload = payload.get("answer")

    answer = answer_payload.get("answer") if isinstance(answer_payload, dict) else None
    answer_result = None
    answer_conversation = None
    if isinstance(answer, dict):
        answer_result = answer.get("result")
        answer_conversation = answer.get("conversation")
    elif isinstance(answer_payload, dict):
        answer_result = answer_payload.get("result")
        answer_conversation = answer_payload.get("conversation")
    result_kind = answer_result.get("kind") if isinstance(answer_result, dict) else None
    text = None
    correlation_id = None

    if isinstance(answer_result, dict):
        text = answer_result.get("text") or answer_result.get("message")
        correlation_id = answer_result.get("request_id")

    if not correlation_id and isinstance(answer_conversation, dict):
        messages = answer_conversation.get("messages")
        if isinstance(messages, list):
            for message in reversed(messages):
                if isinstance(message, dict) and message.get("role") == "assistant":
                    correlation_id = message.get("requestId") or message.get("request_id")
                    if not text:
                        text = message.get("text")
                    break

    return {
        "login_ok": bool(
            isinstance(login_payload, dict)
            and (
                login_payload.get("ok") is True
                or (
                    isinstance(login_payload.get("token"), str)
                    and isinstance(login_payload.get("user"), dict)
                )
            )
        ),
        "conversation_id": _extract_conversation_id(conversation_payload if isinstance(conversation_payload, dict) else {}),
        "answer_kind": result_kind,
        "message": text,
        "correlation_id": correlation_id,
    }


def run_smoke(
    *,
    base_url: str,
    email: str,
    password: str,
    prompt: str,
    name: str,
    mode: str,
) -> dict[str, Any]:
    opener = build_opener()
    login, cookie_header = _login_with_fallback(
        opener,
        base_url=base_url,
        mode=mode,
        name=name,
        email=email,
        password=password,
    )

    if not cookie_header:
        raise RuntimeError(
            f"login did not produce a session cookie: {json.dumps(login, ensure_ascii=False)}"
        )

    authenticated_headers = {"content-type": "application/json"}
    if cookie_header:
        authenticated_headers["cookie"] = cookie_header

    conversation_request = Request(
        f"{base_url}/api/conversations",
        data=b"{}",
        headers=authenticated_headers,
        method="POST",
    )
    try:
        with opener.open(conversation_request) as conversation_response:
            conversation = json.loads(conversation_response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body}
        raise RuntimeError(
            f"{exc.code} {base_url}/api/conversations: {json.dumps(parsed, ensure_ascii=False)}"
        ) from exc

    answer_request = Request(
        f"{base_url}/api/answer",
        data=json.dumps(
            {
                "conversationId": _extract_conversation_id(conversation),
                "prompt": prompt,
            }
        ).encode("utf-8"),
        headers=authenticated_headers,
        method="POST",
    )
    try:
        with opener.open(answer_request) as answer_response:
            answer = json.loads(answer_response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body}
        raise RuntimeError(
            f"{exc.code} {base_url}/api/answer: {json.dumps(parsed, ensure_ascii=False)}"
        ) from exc
    return {
        "login": login,
        "conversation": conversation,
        "answer": answer,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke test the public-consumer-chat live app-local path."
    )
    parser.add_argument("--base-url", default=os.getenv("PUBLIC_CONSUMER_CHAT_APP_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--email", default=os.getenv("PUBLIC_CHAT_SMOKE_EMAIL", DEFAULT_EMAIL))
    parser.add_argument("--password", default=os.getenv("PUBLIC_CHAT_SMOKE_PASSWORD", DEFAULT_PASSWORD))
    parser.add_argument("--prompt", default=os.getenv("PUBLIC_CHAT_SMOKE_PROMPT", DEFAULT_PROMPT))
    parser.add_argument("--name", default=os.getenv("PUBLIC_CHAT_SMOKE_NAME", "Smoke Student"))
    parser.add_argument(
        "--mode",
        default=os.getenv("PUBLIC_CHAT_SMOKE_LOGIN_MODE", "sign-up"),
        choices=("sign-up", "sign-in"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = run_smoke(
        base_url=args.base_url.rstrip("/"),
        email=args.email,
        password=args.password,
        prompt=args.prompt,
        name=args.name,
        mode=args.mode,
    )
    summary = summarize_result(payload)

    print(f"login_ok: {summary['login_ok']}")
    print(f"conversation_id: {summary['conversation_id']}")
    print(f"answer_kind: {summary['answer_kind']}")
    print(f"message: {summary['message']}")
    print(f"correlation_id: {summary['correlation_id']}")
    print("raw_json:")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
