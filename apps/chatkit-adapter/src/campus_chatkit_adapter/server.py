from __future__ import annotations

import os
from collections.abc import AsyncIterator
from hmac import compare_digest
from urllib.parse import urlparse

import uvicorn
from chatkit.server import ChatKitServer, NonStreamingResult, StreamingResult
from chatkit.types import (
    FeedbackKind,
    Page,
    StreamingReq,
    StreamOptions,
    Thread,
    ThreadCreatedEvent,
    ThreadItem,
    ThreadMetadata,
    ThreadsCreateReq,
    ThreadStreamEvent,
    UserMessageItem,
)
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

from .client import AppApiChatClient, AppApiContext
from .mapping import (
    app_conversation_to_thread,
    app_stream_event_to_chatkit_events,
    build_feedback_payload,
    first_user_text,
)
from .store import CampusChatKitStore


def read_required_app_api_base_url() -> str | None:
    value = os.environ.get("APP_API_INTERNAL_BASE_URL", "").strip().rstrip("/")
    if not value:
        return None
    parsed = urlparse(value)
    if not (parsed.scheme and parsed.netloc):
        return None
    return value


def build_context_from_request(request: Request, *, base_url: str) -> AppApiChatClient:
    internal_secret = os.environ.get("APP_API_INTERNAL_SHARED_SECRET", "")
    principal_headers = {
        key: value for key, value in request.headers.items() if key.startswith("x-app-campus-")
    }
    return AppApiChatClient(
        AppApiContext(
            base_url=base_url,
            internal_secret=internal_secret,
            principal_headers=principal_headers,
        )
    )


def has_internal_service_credential(request: Request) -> bool:
    expected = os.environ.get("APP_API_INTERNAL_SHARED_SECRET", "").strip()
    provided = (request.headers.get("x-app-internal-auth") or "").strip()
    return bool(expected and provided and compare_digest(expected, provided))


class CampusChatKitServer(ChatKitServer[AppApiChatClient]):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._active_run_ids_by_thread: dict[str, str] = {}

    def _update_active_run_from_app_event(
        self, thread: ThreadMetadata, event: dict[str, object]
    ) -> None:
        event_name = event.get("event")
        data = event.get("data")
        if not isinstance(data, dict):
            return

        if event_name == "request.accepted":
            run_id = data.get("runId")
            if isinstance(run_id, str) and run_id:
                self._active_run_ids_by_thread[thread.id] = run_id
            return

        if event_name in {"request.completed", "request.failed", "request.cancelled"}:
            self._active_run_ids_by_thread.pop(thread.id, None)

    async def _process_streaming_impl(
        self, request: StreamingReq, context: AppApiChatClient
    ) -> AsyncIterator[ThreadStreamEvent]:
        if isinstance(request, ThreadsCreateReq):
            conversation = await context.create_draft_conversation()
            thread = app_conversation_to_thread(conversation)
            full_thread = Thread(**thread.model_dump(), items=Page())
            yield ThreadCreatedEvent(thread=self._to_thread_response(full_thread))
            user_message = await self._build_user_message_item(
                request.params.input, thread, context
            )
            async for event in self._process_new_thread_item_respond(
                thread,
                user_message,
                context,
            ):
                yield event
            return

        async for event in super()._process_streaming_impl(request, context):
            yield event

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: AppApiChatClient,
    ) -> AsyncIterator[ThreadStreamEvent]:
        prompt = first_user_text(input_user_message)
        async for event in context.submit_prompt_stream(conversation_id=thread.id, prompt=prompt):
            self._update_active_run_from_app_event(thread, event)
            for chatkit_event in app_stream_event_to_chatkit_events(event):
                yield chatkit_event

    async def add_feedback(
        self,
        thread_id: str,
        item_ids: list[str],
        feedback: FeedbackKind,
        context: AppApiChatClient,
    ) -> None:
        payload = build_feedback_payload(feedback)
        for item_id in item_ids:
            await context.submit_feedback(thread_id, item_id, payload)

    def get_stream_options(
        self, thread: ThreadMetadata, context: AppApiChatClient
    ) -> StreamOptions:
        return StreamOptions(allow_cancel=True)

    async def handle_stream_cancelled(
        self,
        thread: ThreadMetadata,
        pending_items: list[ThreadItem],
        context: AppApiChatClient,
    ) -> None:
        run_id = self._active_run_ids_by_thread.pop(thread.id, None) or thread.metadata.get("runId")
        if isinstance(run_id, str) and run_id:
            await context.cancel_run(run_id)


def create_app() -> FastAPI:
    app = FastAPI()
    server = CampusChatKitServer(store=CampusChatKitStore())

    @app.post("/chatkit")
    async def chatkit(request: Request) -> Response:
        if not has_internal_service_credential(request):
            return Response(status_code=401)
        base_url = read_required_app_api_base_url()
        if not base_url:
            return Response(status_code=503)
        result = await server.process(
            await request.body(), context=build_context_from_request(request, base_url=base_url)
        )
        if isinstance(result, StreamingResult):
            return StreamingResponse(result, media_type="text/event-stream")
        if isinstance(result, NonStreamingResult):
            return Response(content=result.json, media_type="application/json")
        return Response(status_code=204)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "campus-chatkit-adapter"}

    return app


app = create_app()


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8765")))
