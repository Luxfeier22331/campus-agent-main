from __future__ import annotations

from dataclasses import dataclass
from threading import Lock

from campus_contracts import SupervisorRequest


@dataclass(slots=True)
class CancelFlag:
    request_id: str
    trace_id: str = ""
    reason: str = ""
    cancel_requested: bool = False


class CancelFlagStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active: dict[str, CancelFlag] = {}

    def register(self, request: SupervisorRequest) -> None:
        if not request.request_id:
            return
        with self._lock:
            self._active[request.request_id] = CancelFlag(
                request_id=request.request_id,
                trace_id=request.trace.trace_id,
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
