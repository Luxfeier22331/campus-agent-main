from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic

from campus_contracts import SupervisorRequest


@dataclass(slots=True)
class CancelFlag:
    request_id: str
    trace_id: str = ""
    reason: str = ""
    cancel_requested: bool = False
    registered_at: float = 0.0


class CancelFlagStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active: dict[str, CancelFlag] = {}

    def register(self, request: SupervisorRequest, *, registered_at: float | None = None) -> None:
        if not request.request_id:
            return
        registered_at = monotonic() if registered_at is None else registered_at
        with self._lock:
            self._active[request.request_id] = CancelFlag(
                request_id=request.request_id,
                trace_id=request.trace.trace_id,
                registered_at=registered_at,
            )

    def complete(self, request_id: str) -> None:
        if not request_id:
            return
        with self._lock:
            self._active.pop(request_id, None)

    def cancel(self, request_id: str, reason: str = "") -> CancelFlag | None:
        with self._lock:
            record = self._active.get(request_id)
            if record is None:
                return None
            record.cancel_requested = True
            record.reason = reason
            return CancelFlag(
                request_id=record.request_id,
                trace_id=record.trace_id,
                reason=record.reason,
                cancel_requested=record.cancel_requested,
            )

    def is_cancel_requested(self, request_id: str) -> bool:
        if not request_id:
            return False
        with self._lock:
            record = self._active.get(request_id)
            return bool(record and record.cancel_requested)

    def prune_stale(self, *, max_age_seconds: float, now: float | None = None) -> int:
        if max_age_seconds <= 0:
            return 0
        now = monotonic() if now is None else now
        with self._lock:
            stale_request_ids = [
                request_id
                for request_id, record in self._active.items()
                if now - record.registered_at > max_age_seconds
            ]
            for request_id in stale_request_ids:
                self._active.pop(request_id, None)
            return len(stale_request_ids)
