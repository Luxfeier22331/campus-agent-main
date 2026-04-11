from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Lock
from typing import Iterator
from uuid import uuid4


_CURRENT_RUNTIME_EVENT_SINK: ContextVar["RuntimeEventWriter | None"] = ContextVar(
    "campus_evals_runtime_event_sink",
    default=None,
)
_CURRENT_RUNTIME_EVENT_CONTEXT: ContextVar[dict[str, object]] = ContextVar(
    "campus_evals_runtime_event_context",
    default={},
)


class RuntimeEventWriter:
    def __init__(
        self,
        *,
        path: str | Path,
        session_id: str | None = None,
        verbose: bool = False,
    ) -> None:
        self.path = Path(path)
        self.session_id = session_id or uuid4().hex
        self.verbose = verbose
        self._lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)

    def emit(self, event_type: str, **payload: object) -> None:
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            "session_id": self.session_id,
            **current_runtime_event_context(),
            **payload,
        }
        serialized = json.dumps(record, ensure_ascii=False)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(serialized)
                handle.write("\n")
        if self.verbose:
            message = _render_verbose_message(record)
            if message:
                print(message)


@contextmanager
def bind_runtime_event_sink(writer: RuntimeEventWriter | None) -> Iterator[RuntimeEventWriter | None]:
    token: Token[RuntimeEventWriter | None] = _CURRENT_RUNTIME_EVENT_SINK.set(writer)
    try:
        yield writer
    finally:
        _CURRENT_RUNTIME_EVENT_SINK.reset(token)


@contextmanager
def bind_runtime_event_context(**fields: object) -> Iterator[dict[str, object]]:
    merged = {
        **current_runtime_event_context(),
        **{key: value for key, value in fields.items() if value is not None},
    }
    token: Token[dict[str, object]] = _CURRENT_RUNTIME_EVENT_CONTEXT.set(merged)
    try:
        yield merged
    finally:
        _CURRENT_RUNTIME_EVENT_CONTEXT.reset(token)


def current_runtime_event_context() -> dict[str, object]:
    return dict(_CURRENT_RUNTIME_EVENT_CONTEXT.get())


def emit_runtime_event(event_type: str, **payload: object) -> None:
    sink = _CURRENT_RUNTIME_EVENT_SINK.get()
    if sink is None:
        return
    sink.emit(event_type, **payload)


def load_runtime_events(path: str | Path, *, session_id: str | None = None) -> list[dict[str, object]]:
    resolved = Path(path)
    if not resolved.exists():
        return []
    events: list[dict[str, object]] = []
    for line in resolved.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        payload = json.loads(stripped)
        if session_id is not None and str(payload.get("session_id") or "") != session_id:
            continue
        events.append(dict(payload))
    return events


def summarize_provider_events(path: str | Path, *, session_id: str | None = None) -> dict[str, object]:
    records = load_runtime_events(path, session_id=session_id)
    grouped: dict[tuple[str, str, str], dict[str, object]] = {}
    for record in records:
        provider_origin = str(record.get("provider_origin") or "")
        endpoint = str(record.get("endpoint") or "")
        model = str(record.get("model") or "")
        if not provider_origin or not endpoint:
            continue
        key = (provider_origin, endpoint, model)
        bucket = grouped.setdefault(
            key,
            {
                "provider_origin": provider_origin,
                "endpoint": endpoint,
                "model": model,
                "request_count": 0,
                "success_count": 0,
                "failure_count": 0,
                "preflight_request_count": 0,
                "preflight_success_count": 0,
                "http_5xx_count": 0,
                "timeout_count": 0,
                "content_filter_count": 0,
                "circuit_open_count": 0,
                "failure_disposition_counts": {},
                "prompt_runtime_state_counts": {},
                "prompt_runtime_detail_counts": {},
            },
        )
        event_type = str(record.get("event_type") or "")
        failure_reasons = [str(item) for item in record.get("failure_reasons") or ()]
        failure_disposition = str(record.get("failure_disposition") or "")
        prompt_runtime_state = str(record.get("prompt_runtime_state") or "")
        prompt_runtime_detail = str(record.get("prompt_runtime_detail") or "")
        if event_type in {"supplemental_request_succeeded", "supplemental_request_failed"}:
            bucket["request_count"] = int(bucket["request_count"]) + 1
            if bool(record.get("preflight")):
                bucket["preflight_request_count"] = int(bucket["preflight_request_count"]) + 1
        if event_type == "supplemental_request_succeeded":
            bucket["success_count"] = int(bucket["success_count"]) + 1
            if bool(record.get("preflight")):
                bucket["preflight_success_count"] = int(bucket["preflight_success_count"]) + 1
        if event_type == "supplemental_request_failed":
            bucket["failure_count"] = int(bucket["failure_count"]) + 1
            if "http_5xx" in failure_reasons:
                bucket["http_5xx_count"] = int(bucket["http_5xx_count"]) + 1
            if "timeout" in failure_reasons:
                bucket["timeout_count"] = int(bucket["timeout_count"]) + 1
            if "content_filter" in failure_reasons or prompt_runtime_state == "content_filter":
                bucket["content_filter_count"] = int(bucket["content_filter_count"]) + 1
            if failure_disposition:
                counts = dict(bucket["failure_disposition_counts"])
                counts[failure_disposition] = int(counts.get(failure_disposition, 0)) + 1
                bucket["failure_disposition_counts"] = counts
            if prompt_runtime_state:
                counts = dict(bucket["prompt_runtime_state_counts"])
                counts[prompt_runtime_state] = int(counts.get(prompt_runtime_state, 0)) + 1
                bucket["prompt_runtime_state_counts"] = counts
            if prompt_runtime_detail:
                counts = dict(bucket["prompt_runtime_detail_counts"])
                counts[prompt_runtime_detail] = int(counts.get(prompt_runtime_detail, 0)) + 1
                bucket["prompt_runtime_detail_counts"] = counts
        if event_type in {"supplemental_breaker_opened", "supplemental_breaker_fast_failed"}:
            bucket["circuit_open_count"] = int(bucket["circuit_open_count"]) + 1

    providers = [
        bucket
        for _, bucket in sorted(grouped.items())
    ]
    return {
        "schema_version": 1,
        "session_id": session_id,
        "provider_count": len(providers),
        "providers": providers,
    }


def summarize_phase15_request_truth(
    records: list[dict[str, object]] | tuple[dict[str, object], ...],
) -> dict[str, object]:
    retrieval_adequacy_verdict_counts: dict[str, int] = {}
    retrieval_adequacy_reason_counts: dict[str, int] = {}
    grounding_verdict_counts: dict[str, int] = {}
    unsupported_claim_type_counts: dict[str, int] = {}
    unsupported_field_counts: dict[str, int] = {}

    for record in records:
        retrieval_adequacy_verdict = str(record.get("retrieval_adequacy_verdict") or "").strip()
        if retrieval_adequacy_verdict:
            retrieval_adequacy_verdict_counts[retrieval_adequacy_verdict] = (
                retrieval_adequacy_verdict_counts.get(retrieval_adequacy_verdict, 0) + 1
            )

        retrieval_adequacy_reason = str(record.get("retrieval_adequacy_reason") or "").strip()
        if retrieval_adequacy_reason:
            retrieval_adequacy_reason_counts[retrieval_adequacy_reason] = (
                retrieval_adequacy_reason_counts.get(retrieval_adequacy_reason, 0) + 1
            )

        grounding_verdict = str(record.get("grounding_verdict") or "").strip()
        if grounding_verdict:
            grounding_verdict_counts[grounding_verdict] = (
                grounding_verdict_counts.get(grounding_verdict, 0) + 1
            )

        claim_support_summary = record.get("claim_support_summary")
        if not isinstance(claim_support_summary, dict):
            continue

        for claim_type in claim_support_summary.get("unsupported_claim_types") or ():
            normalized_claim_type = str(claim_type or "").strip()
            if not normalized_claim_type:
                continue
            unsupported_claim_type_counts[normalized_claim_type] = (
                unsupported_claim_type_counts.get(normalized_claim_type, 0) + 1
            )

        for field_name in claim_support_summary.get("unsupported_fields") or ():
            normalized_field_name = str(field_name or "").strip()
            if not normalized_field_name:
                continue
            unsupported_field_counts[normalized_field_name] = (
                unsupported_field_counts.get(normalized_field_name, 0) + 1
            )

    return {
        "schema_version": 1,
        "request_count": len(records),
        "retrieval_adequacy_verdict_counts": dict(sorted(retrieval_adequacy_verdict_counts.items())),
        "retrieval_adequacy_reason_counts": dict(sorted(retrieval_adequacy_reason_counts.items())),
        "grounding_verdict_counts": dict(sorted(grounding_verdict_counts.items())),
        "unsupported_claim_type_counts": dict(sorted(unsupported_claim_type_counts.items())),
        "unsupported_field_counts": dict(sorted(unsupported_field_counts.items())),
    }


def _render_verbose_message(record: dict[str, object]) -> str:
    event_type = str(record.get("event_type") or "")
    if event_type == "supplemental_preflight_result":
        return (
            f"[preflight] adapter={record.get('adapter_id')} status={record.get('status')} "
            f"action={record.get('run_action')}"
        )
    if event_type == "supplemental_request_failed":
        action = "retrying" if not bool(record.get("final_attempt")) else "failed"
        message = (
            f"[runtime] run={record.get('run_number')} case={record.get('case_id')} "
            f"metric={record.get('adapter_id')}.{record.get('metric_name')} "
            f"{action} attempt={record.get('attempt')}/{record.get('max_attempts')} "
            f"status={record.get('http_status')} disposition={record.get('failure_disposition')}"
        )
        return _append_faithfulness_stage_details(message, record)
    if event_type == "supplemental_request_succeeded" and int(record.get("attempt") or 0) > 1:
        message = (
            f"[runtime] run={record.get('run_number')} case={record.get('case_id')} "
            f"metric={record.get('adapter_id')}.{record.get('metric_name')} "
            f"recovered attempt={record.get('attempt')}/{record.get('max_attempts')} "
            f"status={record.get('http_status')}"
        )
        return _append_faithfulness_stage_details(message, record)
    if event_type == "supplemental_breaker_opened":
        return (
            f"[breaker] opened provider={record.get('provider_origin')} "
            f"metric={record.get('adapter_id')}.{record.get('metric_name')}"
        )
    if event_type == "supplemental_breaker_fast_failed":
        return (
            f"[breaker] fast-fail provider={record.get('provider_origin')} "
            f"metric={record.get('adapter_id')}.{record.get('metric_name')}"
        )
    if event_type == "acceptance_stage":
        return f"[accept] stage={record.get('stage')} status={record.get('status')}"
    if event_type == "faithfulness_checkpoint_hit":
        message = (
            f"[checkpoint] run={record.get('run_number')} case={record.get('case_id')} "
            f"metric={record.get('adapter_id')}.{record.get('metric_name')} "
            f"stage={record.get('faithfulness_stage')}"
        )
        batch_index = record.get("batch_index")
        if batch_index not in (None, ""):
            message = f"{message} batch={batch_index}"
        return message
    return ""


def _append_faithfulness_stage_details(message: str, record: dict[str, object]) -> str:
    stage = record.get("faithfulness_stage")
    if stage in (None, ""):
        return message
    message = f"{message} stage={stage}"
    batch_index = record.get("batch_index")
    if batch_index not in (None, ""):
        message = f"{message} batch={batch_index}"
    return message
