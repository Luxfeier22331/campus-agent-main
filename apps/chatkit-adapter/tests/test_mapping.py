from datetime import UTC, datetime

from campus_chatkit_adapter.mapping import (
    app_conversation_to_thread,
    app_message_to_thread_items,
    app_stream_event_to_chatkit_events,
    build_feedback_payload,
)


def test_maps_conversation_summary_to_chatkit_thread_metadata():
    thread = app_conversation_to_thread(
        {
            "id": "conv_01",
            "title": "校园卡补办",
            "createdAt": "2026-06-12T08:00:00.000Z",
            "updatedAt": "2026-06-12T08:30:00.000Z",
            "archivedAt": None,
            "pinnedAt": None,
        }
    )

    assert thread.id == "conv_01"
    assert thread.title == "校园卡补办"
    assert thread.created_at == datetime(2026, 6, 12, 8, 0, tzinfo=UTC)
    assert thread.metadata["updatedAt"] == "2026-06-12T08:30:00.000Z"


def test_maps_assistant_source_items_to_annotations_without_losing_canonical_href():
    items = app_message_to_thread_items(
        {
            "conversationId": "conv_01",
            "createdAt": "2026-06-12T08:01:00.000Z",
            "feedback": None,
            "id": "msg_02",
            "kind": "answer",
            "requestId": "req_01",
            "retryable": False,
            "role": "assistant",
            "text": "可以在一卡通中心补办。",
            "structuredParts": [
                {
                    "type": "source_items",
                    "sourceItems": [
                        {
                            "collectionLabel": "学生手册",
                            "pageLabel": "校园卡",
                            "primaryAction": {
                                "disabledReason": None,
                                "external": False,
                                "href": "/docs/regulations/student_rules/card?hl=unit_01#replace",
                                "label": "打开原文",
                            },
                            "publisherLabel": "中央民族大学",
                            "sectionTitle": "补办校园卡",
                            "snippet": "校园卡遗失后可到一卡通中心补办。",
                            "title": "学生手册",
                            "trustLabel": "官方",
                            "versionLabel": "2026",
                        }
                    ],
                }
            ],
        }
    )

    assert len(items) == 1
    content = items[0].content[0]
    assert content.text == "可以在一卡通中心补办。"
    assert (
        content.annotations[0].source.url
        == "/docs/regulations/student_rules/card?hl=unit_01#replace"
    )
    assert content.annotations[0].source.title == "学生手册"
    assert content.annotations[0].source.group == "学生手册"
    assert content.annotations[0].source.description == "校园卡遗失后可到一卡通中心补办。"


def test_maps_place_card_to_widget_item_without_flattening_into_answer_text():
    items = app_message_to_thread_items(
        {
            "conversationId": "conv_01",
            "createdAt": "2026-06-12T08:01:00.000Z",
            "feedback": None,
            "id": "msg_02",
            "kind": "answer",
            "requestId": "req_01",
            "retryable": False,
            "role": "assistant",
            "text": "聚雅食堂在丰台校区。",
            "structuredParts": [
                {
                    "type": "place_card",
                    "placeCard": {
                        "accessNote": "从东门进入后沿主路向西。",
                        "campusArea": "丰台校区",
                        "displayName": "聚雅食堂",
                        "locationDescription": "位于丰台校区生活区中部。",
                        "placeId": "fengtai-juya-canteen",
                        "serviceTags": ["餐饮", "清真窗口"],
                    },
                }
            ],
        }
    )

    assert len(items) == 2
    assert items[0].type == "assistant_message"
    assert items[0].content[0].text == "聚雅食堂在丰台校区。"
    assert items[1].type == "widget"
    assert items[1].id == "msg_02_place_fengtai-juya-canteen"
    assert items[1].copy_text == "聚雅食堂\n位于丰台校区生活区中部。\n从东门进入后沿主路向西。"
    widget = items[1].widget.model_dump()
    assert widget["type"] == "Card"
    assert widget["children"][0]["value"] == "聚雅食堂"
    assert widget["children"][1]["label"] == "丰台校区"
    assert widget["children"][3]["value"] == "位于丰台校区生活区中部。"
    assert widget["children"][4]["value"] == "到达提示：从东门进入后沿主路向西。"
    assert [item["label"] for item in widget["children"][5]["children"]] == ["餐饮", "清真窗口"]


def test_maps_completed_stream_event_to_final_assistant_item():
    events = app_stream_event_to_chatkit_events(
        {
            "event": "request.completed",
            "data": {
                "occurredAt": "2026-06-12T08:02:00.000Z",
                "requestId": "req_01",
                "status": "completed",
                "traceId": "trace_01",
                "answer": {
                    "conversation": {
                        "id": "conv_01",
                        "title": "校园卡补办",
                        "createdAt": "2026-06-12T08:00:00.000Z",
                        "updatedAt": "2026-06-12T08:02:00.000Z",
                        "archivedAt": None,
                        "pinnedAt": None,
                        "messages": [
                            {
                                "conversationId": "conv_01",
                                "createdAt": "2026-06-12T08:02:00.000Z",
                                "feedback": None,
                                "id": "msg_02",
                                "kind": "answer",
                                "requestId": "req_01",
                                "retryable": False,
                                "role": "assistant",
                                "text": "可以在一卡通中心补办。",
                            }
                        ],
                    },
                    "result": {
                        "kind": "answer",
                        "requestId": "req_01",
                        "text": "可以在一卡通中心补办。",
                        "traceId": "trace_01",
                    },
                },
            },
        }
    )

    assert len(events) == 1
    assert events[0].type == "thread.item.done"
    assert events[0].item.id == "msg_02"
    assert events[0].item.content[0].text == "可以在一卡通中心补办。"


def test_maps_completed_stream_event_to_assistant_item_and_place_widget():
    events = app_stream_event_to_chatkit_events(
        {
            "event": "request.completed",
            "data": {
                "occurredAt": "2026-06-12T08:02:00.000Z",
                "requestId": "req_01",
                "answer": {
                    "conversation": {
                        "id": "conv_01",
                        "title": "聚雅食堂",
                        "createdAt": "2026-06-12T08:00:00.000Z",
                        "updatedAt": "2026-06-12T08:02:00.000Z",
                        "archivedAt": None,
                        "pinnedAt": None,
                        "messages": [
                            {
                                "conversationId": "conv_01",
                                "createdAt": "2026-06-12T08:02:00.000Z",
                                "feedback": None,
                                "id": "msg_02",
                                "kind": "answer",
                                "requestId": "req_01",
                                "retryable": False,
                                "role": "assistant",
                                "text": "聚雅食堂在丰台校区。",
                                "structuredParts": [
                                    {
                                        "type": "place_card",
                                        "placeCard": {
                                            "campusArea": "丰台校区",
                                            "displayName": "聚雅食堂",
                                            "locationDescription": "位于丰台校区生活区中部。",
                                            "placeId": "fengtai-juya-canteen",
                                        },
                                    }
                                ],
                            }
                        ],
                    },
                    "result": {
                        "kind": "answer",
                        "requestId": "req_01",
                        "text": "聚雅食堂在丰台校区。",
                    },
                },
            },
        }
    )

    assert [event.type for event in events] == ["thread.item.done", "thread.item.done"]
    assert events[0].item.type == "assistant_message"
    assert events[0].item.content[0].text == "聚雅食堂在丰台校区。"
    assert events[1].item.type == "widget"
    assert events[1].item.id == "msg_02_place_fengtai-juya-canteen"


def test_feedback_payload_maps_vote_only_without_reason_code_fallback():
    assert build_feedback_payload("positive") == {"vote": "helpful"}
    assert build_feedback_payload("negative") == {"vote": "unhelpful"}
