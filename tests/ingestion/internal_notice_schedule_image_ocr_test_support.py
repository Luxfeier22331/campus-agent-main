from __future__ import annotations

from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
)


def _evidence(
    *,
    notice_id: str = "355122",
    notice_title: str = "关于两校区学生通勤班车增加班次的通知",
    object_key: str = (
        "authenticated_notice_portal/attachment-fc9a63ccf50c/2026/sha256/"
        "fc9a63ccf50c6aed37042b304901584fbf880f4fe54359b061aeaaa39347f6dc/"
        "capture/table.jpg"
    ),
    sha256: str = "fc9a63ccf50c6aed37042b304901584fbf880f4fe54359b061aeaaa39347f6dc",
    image_use: str = "schedule_table_image",
) -> ScheduleImageOcrEvidence:
    return ScheduleImageOcrEvidence(
        notice_id=notice_id,
        notice_title=notice_title,
        release_time="2026-03-18 11:12",
        organization="丰台校区管理委员会",
        image_index=1,
        attachment_ref_id="attachment-1",
        filename="table.jpg",
        mime_type="image/jpeg",
        byte_size=12,
        sha256=sha256,
        object_key=object_key,
        image_use=image_use,
        reason_codes=("schedule_table_terms_near_image",),
        context_before="3月20日起，对两校区学生通勤班车增加班次。具体见下表：",
        context_after="特此通知。",
    )


class _NoWriteObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)
        self.put_calls: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.put_calls.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


class _FakeOcrProvider:
    def __init__(self, result: ScheduleImageOcrProviderResult) -> None:
        self.result = result
        self.requests: list[object] = []

    def process(self, request: object) -> ScheduleImageOcrProviderResult:
        self.requests.append(request)
        return self.result


class _FakeHttpClient:
    def __init__(self, response: dict[str, object]) -> None:
        self.response = response
        self.posts: list[dict[str, object]] = []

    def post(self, path: str, **kwargs: object) -> _FakeHttpResponse:
        self.posts.append({"path": path, **kwargs})
        return _FakeHttpResponse(self.response)


class _FakeHttpResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload
