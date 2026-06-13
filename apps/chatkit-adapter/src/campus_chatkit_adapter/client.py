from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from .mapping import AppJson


@dataclass(frozen=True)
class AppApiContext:
    base_url: str
    internal_secret: str
    principal_headers: dict[str, str]


class AppApiChatClient:
    def __init__(self, context: AppApiContext, *, client: httpx.AsyncClient | None = None) -> None:
        self._context = context
        self._client = client or httpx.AsyncClient(timeout=None)

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "x-app-internal-auth": self._context.internal_secret,
            **self._context.principal_headers,
        }
        if extra:
            headers.update(extra)
        return headers

    async def list_conversations(self, *, limit: int) -> list[AppJson]:
        response = await self._client.get(
            f"{self._context.base_url}/api/chat/conversations",
            headers=self._headers(),
            params={"limit": str(limit), "view": "active"},
        )
        response.raise_for_status()
        return list(response.json()["conversations"])

    async def create_draft_conversation(self) -> AppJson:
        response = await self._client.post(
            f"{self._context.base_url}/api/chat/conversations",
            headers=self._headers(),
        )
        response.raise_for_status()
        return dict(response.json()["conversation"])

    async def get_conversation(self, conversation_id: str) -> AppJson:
        response = await self._client.get(
            f"{self._context.base_url}/api/chat/conversations/{conversation_id}",
            headers=self._headers(),
        )
        response.raise_for_status()
        return dict(response.json()["conversation"])

    async def rename_conversation(self, conversation_id: str, title: str) -> None:
        response = await self._client.patch(
            f"{self._context.base_url}/api/chat/conversations/{conversation_id}",
            headers=self._headers({"content-type": "application/json"}),
            json={"title": title},
        )
        response.raise_for_status()

    async def delete_conversation(self, conversation_id: str) -> None:
        response = await self._client.delete(
            f"{self._context.base_url}/api/chat/conversations/{conversation_id}",
            headers=self._headers(),
        )
        response.raise_for_status()

    async def submit_feedback(
        self, conversation_id: str, message_id: str, payload: AppJson
    ) -> None:
        response = await self._client.put(
            f"{self._context.base_url}/api/chat/conversations/{conversation_id}/messages/{message_id}/feedback",
            headers=self._headers({"content-type": "application/json"}),
            json=payload,
        )
        response.raise_for_status()

    async def cancel_run(self, run_id: str) -> None:
        response = await self._client.post(
            f"{self._context.base_url}/api/chat/runs/{run_id}/cancel",
            headers=self._headers({"content-type": "application/json"}),
            json={"reason": "user_requested"},
        )
        response.raise_for_status()

    async def delete_trailing_messages(self, conversation_id: str, message_id: str) -> None:
        response = await self._client.delete(
            f"{self._context.base_url}/api/chat/conversations/{conversation_id}/messages/{message_id}/trailing",
            headers=self._headers(),
        )
        response.raise_for_status()

    async def submit_prompt_stream(
        self,
        *,
        conversation_id: str | None,
        prompt: str,
    ) -> AsyncIterator[AppJson]:
        payload: dict[str, str] = {"prompt": prompt}
        if conversation_id:
            payload["conversationId"] = conversation_id
        async with self._client.stream(
            "POST",
            f"{self._context.base_url}/api/chat/requests/stream",
            headers=self._headers(
                {
                    "accept": "text/event-stream",
                    "content-type": "application/json",
                }
            ),
            json=payload,
        ) as response:
            response.raise_for_status()
            async for event in parse_sse_events(response):
                yield event


async def parse_sse_events(response: httpx.Response) -> AsyncIterator[AppJson]:
    event_name: str | None = None
    data_lines: list[str] = []
    async for line in response.aiter_lines():
        if not line:
            if event_name and data_lines:
                yield {
                    "event": event_name,
                    "data": json.loads("\n".join(data_lines)),
                }
            event_name = None
            data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line[len("event:") :].strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line[len("data:") :].strip())
