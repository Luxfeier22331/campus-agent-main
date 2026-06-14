from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
import pytest
from campus_chatkit_adapter.client import AppApiChatClient, AppApiContext
from campus_chatkit_adapter.server import CampusChatKitServer, create_app
from campus_chatkit_adapter.store import CampusChatKitStore
from chatkit.types import (
    InferenceOptions,
    ThreadCreateParams,
    ThreadMetadata,
    ThreadsCreateReq,
    UserMessageInput,
    UserMessageItem,
    UserMessageTextContent,
)
from fastapi.testclient import TestClient


class FakeAppApiClient:
    def __init__(self) -> None:
        self.feedback_calls = []
        self.cancel_calls = []
        self.deleted_threads = []
        self.created_draft_count = 0
        self.renamed_threads = []
        self.submitted_prompts = []
        self.conversations = [
            {
                "id": "conv_01",
                "title": "校园卡补办",
                "createdAt": "2026-06-12T08:00:00.000Z",
                "updatedAt": "2026-06-12T08:30:00.000Z",
                "archivedAt": None,
                "pinnedAt": None,
            }
        ]
        self.detail = {
            **self.conversations[0],
            "messages": [
                {
                    "conversationId": "conv_01",
                    "createdAt": "2026-06-12T08:01:00.000Z",
                    "id": "msg_user_01",
                    "role": "user",
                    "text": "校园卡怎么补办？",
                },
                {
                    "conversationId": "conv_01",
                    "createdAt": "2026-06-12T08:02:00.000Z",
                    "feedback": None,
                    "id": "msg_assistant_01",
                    "kind": "answer",
                    "requestId": "req_01",
                    "retryable": False,
                    "role": "assistant",
                    "text": "可以到一卡通中心补办。",
                },
            ],
        }

    async def list_conversations(self, *, limit: int):
        return self.conversations[:limit]

    async def create_draft_conversation(self):
        self.created_draft_count += 1
        return {
            **self.conversations[0],
            "id": "conv_created_by_app_api",
            "messages": [],
        }

    async def get_conversation(self, conversation_id: str):
        assert conversation_id == "conv_01"
        return self.detail

    async def rename_conversation(self, conversation_id: str, title: str) -> None:
        self.renamed_threads.append((conversation_id, title))

    async def delete_conversation(self, conversation_id: str) -> None:
        self.deleted_threads.append(conversation_id)

    async def submit_feedback(self, conversation_id: str, message_id: str, payload: dict) -> None:
        self.feedback_calls.append((conversation_id, message_id, payload))

    async def cancel_run(self, run_id: str) -> None:
        self.cancel_calls.append(run_id)

    async def delete_trailing_messages(self, conversation_id: str, message_id: str) -> None:
        self.deleted_threads.append(f"{conversation_id}:{message_id}:trailing")

    async def submit_prompt_stream(
        self, *, conversation_id: str | None, prompt: str
    ) -> AsyncIterator[dict]:
        self.submitted_prompts.append((conversation_id, prompt))
        yield {
            "event": "request.accepted",
            "data": {
                "occurredAt": "2026-06-12T08:01:30.000Z",
                "requestId": "req_01",
                "runId": "run_accepted_01",
                "status": "accepted",
            },
        }
        yield {
            "event": "request.completed",
            "data": {
                "occurredAt": "2026-06-12T08:02:00.000Z",
                "requestId": "req_01",
                "answer": {
                    "conversation": self.detail,
                    "result": {
                        "kind": "answer",
                        "requestId": "req_01",
                        "text": "可以到一卡通中心补办。",
                    },
                },
            },
        }


class AcceptedOnlyFakeAppApiClient(FakeAppApiClient):
    async def submit_prompt_stream(
        self, *, conversation_id: str | None, prompt: str
    ) -> AsyncIterator[dict]:
        self.submitted_prompts.append((conversation_id, prompt))
        yield {
            "event": "request.accepted",
            "data": {
                "occurredAt": "2026-06-12T08:01:30.000Z",
                "requestId": "req_01",
                "runId": "run_accepted_01",
                "status": "accepted",
            },
        }


@pytest.mark.asyncio
async def test_store_maps_threads_items_rename_and_delete_to_app_api():
    client = FakeAppApiClient()
    store = CampusChatKitStore()

    threads = await store.load_threads(limit=10, after=None, order="desc", context=client)
    assert threads.data[0].id == "conv_01"
    assert threads.data[0].title == "校园卡补办"

    items = await store.load_thread_items(
        thread_id="conv_01", after=None, limit=10, order="asc", context=client
    )
    assert [item.id for item in items.data] == ["msg_user_01", "msg_assistant_01"]

    await store.save_thread(
        ThreadMetadata(
            id="conv_01",
            title="新标题",
            created_at=datetime(2026, 6, 12, 8, 0, tzinfo=UTC),
        ),
        context=client,
    )
    await store.delete_thread("conv_01", context=client)

    assert client.renamed_threads == [("conv_01", "新标题")]
    assert client.deleted_threads == ["conv_01"]


@pytest.mark.asyncio
async def test_server_creates_new_thread_through_app_api_draft_conversation():
    client = FakeAppApiClient()
    server = CampusChatKitServer(store=CampusChatKitStore())

    request = ThreadsCreateReq(
        params=ThreadCreateParams(
            input=UserMessageInput(
                attachments=[],
                content=[UserMessageTextContent(text="校园卡怎么补办？")],
                inference_options=InferenceOptions(),
            )
        )
    )
    events = [event async for event in server._process_streaming_impl(request, client)]

    assert events[0].type == "thread.created"
    assert events[0].thread.id == "conv_created_by_app_api"
    assert client.submitted_prompts == [("conv_created_by_app_api", "校园卡怎么补办？")]
    assert client.created_draft_count == 1


@pytest.mark.asyncio
async def test_server_stream_feedback_and_cancel_call_app_api_commands():
    client = FakeAppApiClient()
    server = CampusChatKitServer(store=CampusChatKitStore())
    thread = ThreadMetadata(
        id="conv_01",
        title="校园卡补办",
        created_at=datetime(2026, 6, 12, 8, 0, tzinfo=UTC),
        metadata={"runId": "run_01"},
    )
    user_message = UserMessageItem(
        id="msg_user_new",
        thread_id="conv_01",
        created_at=datetime(2026, 6, 12, 8, 3, tzinfo=UTC),
        content=[UserMessageTextContent(text="校园卡怎么补办？")],
        inference_options=InferenceOptions(),
    )

    events = [event async for event in server.respond(thread, user_message, client)]
    assert client.submitted_prompts == [("conv_01", "校园卡怎么补办？")]
    assert events[-1].type == "thread.item.done"
    assert events[-1].item.id == "msg_assistant_01"

    await server.add_feedback("conv_01", ["msg_assistant_01"], "positive", client)
    assert client.feedback_calls == [("conv_01", "msg_assistant_01", {"vote": "helpful"})]

    await server.handle_stream_cancelled(thread, [], client)
    assert client.cancel_calls == ["run_01"]


@pytest.mark.asyncio
async def test_server_tracks_accepted_run_for_stream_cancel():
    client = AcceptedOnlyFakeAppApiClient()
    server = CampusChatKitServer(store=CampusChatKitStore())
    thread = ThreadMetadata(
        id="conv_01",
        title="校园卡补办",
        created_at=datetime(2026, 6, 12, 8, 0, tzinfo=UTC),
    )
    user_message = UserMessageItem(
        id="msg_user_new",
        thread_id="conv_01",
        created_at=datetime(2026, 6, 12, 8, 3, tzinfo=UTC),
        content=[UserMessageTextContent(text="校园卡怎么补办？")],
        inference_options=InferenceOptions(),
    )

    events = [event async for event in server.respond(thread, user_message, client)]
    assert [event.type for event in events] == ["progress_update"]

    await server.handle_stream_cancelled(thread, [], client)

    assert client.cancel_calls == ["run_accepted_01"]


@pytest.mark.asyncio
async def test_store_deletes_trailing_messages_through_app_api():
    client = FakeAppApiClient()
    store = CampusChatKitStore()

    await store.delete_thread_item("conv_01", "msg_user_01", context=client)

    assert client.deleted_threads == ["conv_01:msg_user_01:trailing"]


def test_adapter_http_endpoint_requires_internal_service_credential(monkeypatch):
    monkeypatch.setenv("APP_API_INTERNAL_SHARED_SECRET", "trusted-secret")
    monkeypatch.setenv("APP_API_INTERNAL_BASE_URL", "https://app-api.internal")
    client = TestClient(create_app())

    missing = client.post("/chatkit", json={"type": "threads.list"})
    assert missing.status_code == 401

    wrong = client.post(
        "/chatkit",
        headers={"x-app-internal-auth": "wrong-secret"},
        json={"type": "threads.list"},
    )
    assert wrong.status_code == 401


def test_adapter_http_endpoint_requires_explicit_app_api_base_url(monkeypatch):
    monkeypatch.setenv("APP_API_INTERNAL_SHARED_SECRET", "trusted-secret")
    monkeypatch.delenv("APP_API_INTERNAL_BASE_URL", raising=False)
    client = TestClient(create_app())

    response = client.post(
        "/chatkit",
        headers={"x-app-internal-auth": "trusted-secret"},
        json={"type": "threads.list"},
    )

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_app_api_client_creates_draft_conversation_through_app_api_command():
    seen: list[tuple[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, str(request.url)))
        return httpx.Response(
            201,
            json={
                "conversation": {
                    "archivedAt": None,
                    "createdAt": "2026-06-12T08:00:00.000Z",
                    "id": "conv_created_by_app_api",
                    "messages": [],
                    "pinnedAt": None,
                    "title": "新对话",
                    "updatedAt": "2026-06-12T08:00:00.000Z",
                }
            },
        )

    client = AppApiChatClient(
        AppApiContext(
            base_url="https://app-api.internal",
            internal_secret="trusted-secret",
            principal_headers={"x-app-campus-principal-id": "user_01"},
        ),
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    conversation = await client.create_draft_conversation()

    assert conversation["id"] == "conv_created_by_app_api"
    assert seen == [("POST", "https://app-api.internal/api/chat/conversations")]


@pytest.mark.asyncio
async def test_app_api_client_deletes_trailing_messages_through_explicit_contract():
    seen: list[tuple[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, str(request.url)))
        return httpx.Response(204)

    client = AppApiChatClient(
        AppApiContext(
            base_url="https://app-api.internal",
            internal_secret="trusted-secret",
            principal_headers={"x-app-campus-principal-id": "user_01"},
        ),
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    await client.delete_trailing_messages("conv_01", "msg_user_01")

    assert seen == [
        (
            "DELETE",
            "https://app-api.internal/api/chat/conversations/conv_01/messages/msg_user_01/trailing",
        )
    ]
