from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal, cast

from chatkit.types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageItem,
    ErrorEvent,
    FeedbackKind,
    InferenceOptions,
    Page,
    ProgressUpdateEvent,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    URLSource,
    UserMessageItem,
    UserMessageTextContent,
    WidgetItem,
)
from chatkit.widgets import DynamicWidgetRoot

AppJson = dict[str, Any]


def parse_app_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def app_conversation_to_thread(conversation: AppJson) -> ThreadMetadata:
    return ThreadMetadata(
        id=str(conversation["id"]),
        title=str(conversation.get("title") or "新对话"),
        created_at=parse_app_datetime(str(conversation["createdAt"])),
        metadata={
            "archivedAt": conversation.get("archivedAt"),
            "pinnedAt": conversation.get("pinnedAt"),
            "updatedAt": conversation.get("updatedAt"),
        },
    )


def app_conversations_to_page(
    conversations: list[AppJson],
    *,
    after: str | None,
    limit: int,
) -> Page[ThreadMetadata]:
    threads = [app_conversation_to_thread(conversation) for conversation in conversations]
    page = threads[:limit]
    return Page(
        data=page,
        has_more=len(threads) > limit,
        after=page[-1].id if len(threads) > limit and page else after,
    )


def app_message_to_thread_items(message: AppJson) -> list[ThreadItem]:
    role = message.get("role")
    if role == "user":
        return [
            UserMessageItem(
                id=str(message["id"]),
                thread_id=str(message["conversationId"]),
                created_at=parse_app_datetime(str(message["createdAt"])),
                content=[UserMessageTextContent(text=str(message.get("text") or ""))],
                inference_options=InferenceOptions(),
            )
        ]
    if role == "assistant":
        return [
            AssistantMessageItem(
                id=str(message["id"]),
                thread_id=str(message["conversationId"]),
                created_at=parse_app_datetime(str(message["createdAt"])),
                content=[
                    AssistantMessageContent(
                        text=str(message.get("text") or ""),
                        annotations=build_source_annotations(message),
                    )
                ],
            ),
            *build_place_widget_items(message),
        ]
    return []


def app_messages_to_page(
    messages: list[AppJson], *, after: str | None, limit: int
) -> Page[ThreadItem]:
    items: list[ThreadItem] = []
    for message in messages:
        items.extend(app_message_to_thread_items(message))
    if after:
        try:
            after_index = next(index for index, item in enumerate(items) if item.id == after)
            items = items[after_index + 1 :]
        except StopIteration:
            items = []
    page = items[:limit]
    return Page(
        data=page,
        has_more=len(items) > limit,
        after=page[-1].id if len(items) > limit and page else after,
    )


def build_place_widget_items(message: AppJson) -> list[WidgetItem]:
    items: list[WidgetItem] = []
    for part in message.get("structuredParts") or []:
        if part.get("type") != "place_card":
            continue
        card = part.get("placeCard") or {}
        display_name = card.get("displayName")
        location = card.get("locationDescription")
        place_id = card.get("placeId")
        if not (display_name and location and place_id):
            continue
        items.append(
            WidgetItem(
                id=f"{message['id']}_place_{place_id}",
                thread_id=str(message["conversationId"]),
                created_at=parse_app_datetime(str(message["createdAt"])),
                widget=build_place_widget(card),
                copy_text=build_place_copy_text(card),
            )
        )
    return items


def build_place_widget(card: AppJson) -> DynamicWidgetRoot:
    children: list[AppJson] = [
        {
            "type": "Title",
            "value": str(card["displayName"]),
            "size": "sm",
            "weight": "semibold",
        }
    ]
    campus_area = card.get("campusArea")
    if campus_area:
        children.append({"type": "Badge", "label": str(campus_area), "variant": "soft"})
    children.extend(
        [
            {"type": "Caption", "value": "地点信息", "color": "secondary"},
            {"type": "Text", "value": str(card["locationDescription"])},
        ]
    )
    access_note = card.get("accessNote")
    if access_note:
        children.append({"type": "Text", "value": f"到达提示：{access_note}", "color": "secondary"})
    service_tags = card.get("serviceTags") or []
    if service_tags:
        children.append(
            {
                "type": "Row",
                "children": [
                    {"type": "Badge", "label": str(tag), "variant": "outline"}
                    for tag in service_tags
                    if tag
                ],
                "wrap": "wrap",
            }
        )
    return DynamicWidgetRoot.model_validate(
        {
            "type": "Card",
            "children": children,
            "padding": 12,
            "size": "sm",
        }
    )


def build_place_copy_text(card: AppJson) -> str:
    lines = [
        str(card["displayName"]),
        str(card["locationDescription"]),
        *(str(card.get("accessNote")).splitlines() if card.get("accessNote") else []),
    ]
    return "\n".join(line for line in lines if line)


def build_source_annotations(message: AppJson) -> list[Annotation]:
    annotations: list[Annotation] = []
    for part in message.get("structuredParts") or []:
        if part.get("type") != "source_items":
            continue
        for source in part.get("sourceItems") or []:
            primary_action = source.get("primaryAction") or {}
            href = primary_action.get("href")
            if not href:
                continue
            annotations.append(
                Annotation(
                    source=URLSource(
                        url=str(href),
                        title=str(source.get("title") or source.get("sectionTitle") or "来源"),
                        description=str(source.get("snippet") or source.get("sectionTitle") or ""),
                        group=str(source.get("collectionLabel") or ""),
                        attribution=build_source_attribution(source),
                    )
                )
            )
    return annotations


def build_source_attribution(source: AppJson) -> str:
    labels = [
        source.get("publisherLabel"),
        source.get("trustLabel"),
        source.get("versionLabel"),
    ]
    return " · ".join(str(label) for label in labels if label)


def app_stream_event_to_chatkit_events(event: AppJson) -> list[ThreadStreamEvent]:
    event_name = event.get("event")
    data = event.get("data") or {}
    if event_name in {"execution.queued", "execution.running", "request.accepted"}:
        return [
            ProgressUpdateEvent(
                text={
                    "execution.queued": "正在排队",
                    "execution.running": "正在查询校园信息",
                    "request.accepted": "正在生成回答",
                }.get(str(event_name), "正在处理"),
                icon="sparkle",
            )
        ]
    if event_name == "request.completed":
        answer = data.get("answer") or {}
        conversation = answer.get("conversation") or {}
        messages = conversation.get("messages") or []
        if messages:
            assistant_message = next(
                (message for message in reversed(messages) if message.get("role") == "assistant"),
                None,
            )
            if assistant_message:
                return [
                    ThreadItemDoneEvent(item=item)
                    for item in app_message_to_thread_items(assistant_message)
                ]
        result = answer.get("result") or {}
        if result.get("text"):
            return [
                ThreadItemDoneEvent(
                    item=AssistantMessageItem(
                        id=str(result.get("requestId") or data.get("requestId") or "assistant"),
                        thread_id=str(conversation.get("id") or ""),
                        created_at=parse_app_datetime(str(data["occurredAt"])),
                        content=[AssistantMessageContent(text=str(result["text"]))],
                    )
                )
            ]
        return []
    if event_name == "request.failed":
        error = data.get("error") or {}
        return [
            ErrorEvent(
                message=str(error.get("message") or "回答暂时没有生成。"),
                allow_retry=bool(error.get("retryable")),
            )
        ]
    if event_name == "request.cancelled":
        return [ErrorEvent(message="已停止。", allow_retry=False)]
    return []


def build_feedback_payload(feedback: FeedbackKind) -> dict[str, Literal["helpful", "unhelpful"]]:
    if feedback == "positive":
        return {"vote": "helpful"}
    if feedback == "negative":
        return {"vote": "unhelpful"}
    raise ValueError(f"Unsupported ChatKit feedback kind: {feedback}")


def first_user_text(item: UserMessageItem | None) -> str:
    if item is None:
        return ""
    for content in item.content:
        if getattr(content, "type", None) == "input_text":
            return str(getattr(content, "text", "")).strip()
    return ""


def cast_thread_item(item: Any) -> ThreadItem:
    return cast(ThreadItem, item)
