from __future__ import annotations

import json
import os
from base64 import b64encode
from collections.abc import Mapping, Sequence
from typing import Any

import httpx

from campus_ingestion_core.internal_notice_schedule_image_ocr_constants import (
    DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL,
    DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrProviderResult,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_scalars import _compact


class ChatCompletionsScheduleImageOcrProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        provider: str = "openai-chat-completions",
        base_url: str = DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL,
        max_output_tokens: int = DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("schedule image OCR api_key must not be empty")
        if not model.strip():
            raise ValueError("schedule image OCR model must not be empty")
        if not provider.strip():
            raise ValueError("schedule image OCR provider must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("schedule image OCR max_output_tokens must be greater than zero")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._provider = provider.strip()
        self._max_output_tokens = max_output_tokens
        self._http_client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=3.0),
            trust_env=False,
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> ChatCompletionsScheduleImageOcrProvider:
        source = env if env is not None else os.environ
        api_key = (source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY") or "").strip()
        model = (source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL") or "").strip()
        provider = (
            source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_PROVIDER") or "openai-chat-completions"
        ).strip()
        base_url = (
            source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_BASE_URL")
            or DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL
        ).strip()
        max_output_tokens = int(
            (
                source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS")
                or str(DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS)
            ).strip()
        )
        if not api_key:
            raise ValueError("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY is required")
        if not model:
            raise ValueError("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL is required")
        return cls(
            api_key=api_key,
            model=model,
            provider=provider,
            base_url=base_url,
            max_output_tokens=max_output_tokens,
        )

    def process(self, request: ScheduleImageOcrProviderRequest) -> ScheduleImageOcrProviderResult:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract only visible campus transport schedule facts from the image. "
                        "Return structured JSON. Extract every visible data row, not only table "
                        "titles or headers. Return tables as row matrices. When a visible merged "
                        "cell spans multiple rows or columns, repeat that visible cell text in "
                        "each affected matrix cell. Do not infer missing route, date, or time "
                        "values from outside the image. If guide or reservation text is visible, "
                        "include it in extracted_text but do not merge it into tables."
                    ),
                },
                {
                    "role": "user",
                    "content": _build_chat_ocr_user_content(request),
                },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "internal_notice_schedule_image_ocr",
                    "schema": _schedule_ocr_schema(),
                    "strict": True,
                },
            },
            "max_completion_tokens": self._max_output_tokens,
        }
        response = self._http_client.post(
            "/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        response_json = response.json()
        parsed = _extract_chat_completions_payload(response_json)
        return _coerce_provider_result(
            parsed,
            provider=self._provider,
            model=self._model,
            raw_response=response_json if isinstance(response_json, dict) else parsed,
        )


def _build_chat_ocr_user_content(
    request: ScheduleImageOcrProviderRequest,
) -> list[dict[str, object]]:
    evidence = request.evidence
    return [
        {
            "type": "text",
            "text": (
                f"Notice id: {evidence.notice_id}\n"
                f"Notice title: {evidence.notice_title}\n"
                f"Release time: {evidence.release_time}\n"
                f"Organization: {evidence.organization}\n"
                f"Image use candidate: {evidence.image_use}\n"
                f"Context before: {evidence.context_before}\n"
                f"Context after: {evidence.context_after}\n"
                "Extract visible transport timetable text and tables. Include all readable "
                "body rows. If the image contains a timetable table, tables must include the "
                "header row plus body rows with departure times."
            ),
        },
        {
            "type": "image_url",
            "image_url": {
                "url": _data_url(evidence.mime_type, request.image_bytes),
                "detail": "high",
            },
        },
    ]


def _data_url(mime_type: str, data: bytes) -> str:
    return f"data:{mime_type};base64,{b64encode(data).decode('ascii')}"


def _schedule_ocr_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["confidence", "extracted_text", "tables", "layout_elements"],
        "properties": {
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "extracted_text": {"type": "string"},
            "tables": {
                "type": "array",
                "items": {
                    "type": "array",
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
            },
            "layout_elements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": True,
                },
            },
        },
    }


def _extract_chat_completions_payload(response_json: object) -> dict[str, object]:
    if not isinstance(response_json, dict):
        raise ValueError("schedule image OCR response must be a JSON object")
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("schedule image OCR response missing choices")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("schedule image OCR choice must be an object")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("schedule image OCR choice missing message")
    parsed = message.get("parsed")
    if isinstance(parsed, dict):
        return parsed
    content = message.get("content")
    if isinstance(content, str):
        payload = json.loads(content)
        if isinstance(payload, dict):
            return payload
    raise ValueError("schedule image OCR message content must be a JSON object")


def _coerce_provider_result(
    payload: Mapping[str, object],
    *,
    provider: str,
    model: str,
    raw_response: Mapping[str, Any] | Sequence[Any] | str | None,
) -> ScheduleImageOcrProviderResult:
    confidence = str(payload.get("confidence") or "").strip()
    extracted_text = _coerce_extracted_text(payload.get("extracted_text"))
    tables = _coerce_tables(payload.get("tables"))
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium" if tables else "low"
    layout_elements = tuple(
        dict(item) for item in (payload.get("layout_elements") or ()) if isinstance(item, dict)
    )
    return ScheduleImageOcrProviderResult(
        provider=provider,
        model=model,
        confidence=confidence,  # type: ignore[arg-type]
        extracted_text=extracted_text,
        tables=tables,
        layout_elements=layout_elements,
        raw_response=raw_response,
    )


def _coerce_extracted_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list | tuple):
        return "\n".join(str(item or "").strip() for item in value if str(item or "").strip())
    return str(value or "").strip()


def _coerce_tables(value: object) -> tuple[tuple[tuple[str, ...], ...], ...]:
    if not isinstance(value, list | tuple):
        return ()
    tables: list[tuple[tuple[str, ...], ...]] = []
    for raw_table in value:
        if isinstance(raw_table, dict):
            table_rows = _coerce_table_object(raw_table)
            if table_rows:
                tables.append(tuple(table_rows))
            continue
        if not isinstance(raw_table, list | tuple):
            continue
        rows: list[tuple[str, ...]] = []
        for raw_row in raw_table:
            if isinstance(raw_row, list | tuple):
                rows.append(tuple(_cell_text(cell) for cell in raw_row))
        if rows:
            tables.append(tuple(rows))
    return tuple(tables)


def _coerce_table_object(raw_table: Mapping[str, object]) -> list[tuple[str, ...]]:
    columns = raw_table.get("columns") or raw_table.get("headers")
    rows_value = raw_table.get("rows")
    table_rows: list[tuple[str, ...]] = []
    target_width = 0
    if isinstance(columns, list | tuple):
        header = tuple(_cell_text(cell) for cell in columns)
        table_rows.append(header)
        target_width = len(header)
    headers = table_rows[0] if table_rows else ()
    if isinstance(rows_value, list | tuple):
        if _is_dict_table_rows(rows_value):
            table_rows.extend(_coerce_dict_rows(rows_value, headers=headers))
        else:
            table_rows.extend(_coerce_table_rows(rows_value, target_width=target_width))
    cells_value = raw_table.get("cells")
    if not rows_value and isinstance(cells_value, list | tuple):
        table_rows.extend(_coerce_cells_value(cells_value, headers=headers))
    row_groups = raw_table.get("row_groups")
    if not rows_value and not cells_value and isinstance(row_groups, list | tuple):
        table_rows.extend(_coerce_row_groups(row_groups, headers=headers))
    return table_rows


def _is_dict_table_rows(rows_value: Sequence[object]) -> bool:
    return any(isinstance(row, Mapping) and "cells" not in row for row in rows_value)


def _coerce_dict_rows(
    raw_rows: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not headers:
        return []
    rows: list[tuple[str, ...]] = []
    previous: list[str] = [""] * len(headers)
    for raw_row in raw_rows:
        if not isinstance(raw_row, Mapping):
            continue
        row: list[str] = []
        for index, header in enumerate(headers):
            value = _cell_text(raw_row.get(header))
            if not value and _should_fill_down_header(header):
                value = previous[index]
            row.append(value)
        if any(row):
            rows.append(tuple(row))
            previous = row
    return rows


def _coerce_cells_value(
    cells_value: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not cells_value:
        return []
    if all(isinstance(row, list | tuple) for row in cells_value):
        return _coerce_table_rows(cells_value, target_width=len(headers))
    if any(isinstance(cell, Mapping) and _has_position(cell) for cell in cells_value):
        return _coerce_positioned_cells(cells_value, headers=headers)
    return []


def _coerce_positioned_cells(
    cells_value: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not headers:
        return []
    rows: dict[int, dict[int, str]] = {}
    for raw_cell in cells_value:
        if not isinstance(raw_cell, Mapping):
            continue
        row_index = _position_index(raw_cell.get("row"))
        column_index = _column_index(raw_cell, headers=headers)
        if row_index is None or column_index is None:
            continue
        text = _cell_text(raw_cell)
        row_span = _span_value(raw_cell, "rowspan")
        col_span = _span_value(raw_cell, "colspan")
        for row_offset in range(row_span):
            row = rows.setdefault(row_index + row_offset, {})
            for col_offset in range(col_span):
                row[column_index + col_offset] = text
    if not rows:
        return []
    body_rows: list[tuple[str, ...]] = []
    width = len(headers)
    previous: list[str] = [""] * width
    for row_index in sorted(rows):
        raw_row = rows[row_index]
        row = [raw_row.get(index, "") for index in range(width)]
        if tuple(row) == tuple(headers):
            continue
        row = [
            value or (previous[index] if _should_fill_down_header(headers[index]) else "")
            for index, value in enumerate(row)
        ]
        if any(row):
            body_rows.append(tuple(row))
            previous = row
    return body_rows


def _coerce_row_groups(
    row_groups: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not headers:
        return []
    rows: list[tuple[str, ...]] = []
    for group in row_groups:
        if isinstance(group, Mapping):
            rows.extend(_coerce_row_group(group, headers=headers, inherited={}))
    return rows


def _coerce_row_group(
    group: Mapping[str, object],
    *,
    headers: Sequence[str],
    inherited: Mapping[str, str],
) -> list[tuple[str, ...]]:
    context = dict(inherited)
    for key, value in group.items():
        if key == "rows" or key.endswith("_groups"):
            continue
        if key in headers:
            context[key] = _cell_text(value)
    rows: list[tuple[str, ...]] = []
    raw_rows = group.get("rows")
    if isinstance(raw_rows, list | tuple):
        for raw_row in raw_rows:
            if not isinstance(raw_row, Mapping):
                continue
            merged = dict(context)
            merged.update({key: _cell_text(value) for key, value in raw_row.items()})
            rows.append(tuple(merged.get(header, "") for header in headers))
    for key, value in group.items():
        if not key.endswith("_groups") or not isinstance(value, list | tuple):
            continue
        for nested_group in value:
            if isinstance(nested_group, Mapping):
                rows.extend(_coerce_row_group(nested_group, headers=headers, inherited=context))
    return rows


def _coerce_table_rows(
    raw_rows: Sequence[object],
    *,
    target_width: int,
) -> list[tuple[str, ...]]:
    rows: list[tuple[str, ...]] = []
    active_rowspans: dict[int, tuple[str, int]] = {}
    for raw_row in raw_rows:
        raw_cells = _row_cells(raw_row)
        if raw_cells is None:
            continue
        row, active_rowspans = _coerce_table_row(
            raw_cells,
            active_rowspans=active_rowspans,
            target_width=target_width,
        )
        if row:
            rows.append(row)
            target_width = max(target_width, len(row))
    return rows


def _row_cells(raw_row: object) -> Sequence[object] | None:
    if isinstance(raw_row, Mapping):
        cells = raw_row.get("cells")
        if isinstance(cells, list | tuple):
            return cells
        return None
    if isinstance(raw_row, list | tuple):
        return raw_row
    return None


def _coerce_table_row(
    raw_cells: Sequence[object],
    *,
    active_rowspans: Mapping[int, tuple[str, int]],
    target_width: int,
) -> tuple[tuple[str, ...], dict[int, tuple[str, int]]]:
    row: list[str] = []
    next_rowspans: dict[int, tuple[str, int]] = {}
    new_rowspans: dict[int, tuple[str, int]] = {}
    filled_active_columns: set[int] = set()
    column_index = 0

    def fill_active_cell() -> bool:
        nonlocal column_index
        active = active_rowspans.get(column_index)
        if active is None:
            return False
        text, remaining = active
        row.append(text)
        filled_active_columns.add(column_index)
        if remaining > 1:
            next_rowspans[column_index] = (text, remaining - 1)
        column_index += 1
        return True

    for raw_cell in raw_cells:
        while fill_active_cell():
            continue
        text = _cell_text(raw_cell)
        colspan = _span_value(raw_cell, "colspan")
        rowspan = _span_value(raw_cell, "rowspan")
        for span_offset in range(colspan):
            current_column = column_index + span_offset
            row.append(text)
            if rowspan > 1:
                new_rowspans[current_column] = (text, rowspan - 1)
        column_index += colspan

    width = max(target_width, column_index, max(active_rowspans, default=-1) + 1)
    while column_index < width:
        if not fill_active_cell():
            row.append("")
            column_index += 1

    for column, (text, remaining) in active_rowspans.items():
        if column not in filled_active_columns and remaining > 1:
            next_rowspans[column] = (text, remaining - 1)
    next_rowspans.update(new_rowspans)
    return tuple(row), next_rowspans


def _span_value(value: object, key: str) -> int:
    if not isinstance(value, Mapping):
        return 1
    aliases = {
        "rowspan": ("rowspan", "row_span"),
        "colspan": ("colspan", "col_span"),
    }
    try:
        span = int(
            next((value.get(alias) for alias in aliases.get(key, (key,)) if value.get(alias)), 1)
        )
    except (TypeError, ValueError):
        span = 1
    return max(1, span)


def _has_position(value: Mapping[str, object]) -> bool:
    return "row" in value and ("column" in value or "col" in value)


def _position_index(value: object) -> int | None:
    try:
        index = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return max(0, index)


def _column_index(value: Mapping[str, object], *, headers: Sequence[str]) -> int | None:
    raw_column = value.get("column", value.get("col"))
    if isinstance(raw_column, str) and raw_column in headers:
        return list(headers).index(raw_column)
    try:
        index = int(raw_column)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if index <= 0:
        return 0
    return index - 1


def _should_fill_down_header(header: str) -> bool:
    compact_header = _compact(header)
    return compact_header in {
        "日期",
        "星期",
        "线路",
        "路线",
        "运行方向",
        "发车地点",
        "备注",
    }


def _cell_text(value: object) -> str:
    if isinstance(value, dict):
        return str(value.get("text") or "").strip()
    return str(value or "").strip()
