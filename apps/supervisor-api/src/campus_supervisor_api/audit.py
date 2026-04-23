from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, Lock, Thread
import time

from campus_supervisor_core import SupervisorAuditRecord

AuditSink = Callable[[SupervisorAuditRecord], None]


class AuditSinkError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AuditRuntimeStatus:
    healthy: bool
    queue_depth: int
    queue_capacity: int
    dropped_count: int
    writer_alive: bool
    last_error: str


def build_jsonl_audit_sink(path: Path) -> AuditSink:
    def sink(record: SupervisorAuditRecord) -> None:
        _write_jsonl_audit_record(path, record)

    return sink


class AsyncJsonlAuditRuntime:
    def __init__(self, path: Path, *, queue_capacity: int = 1024) -> None:
        if queue_capacity <= 0:
            raise ValueError("queue_capacity must be greater than zero")
        self.path = path
        self.queue_capacity = queue_capacity
        self._queue: Queue[SupervisorAuditRecord] = Queue(maxsize=queue_capacity)
        self._stop_requested = Event()
        self._dropped_count = 0
        self._last_error = ""
        self._lock = Lock()
        self._writer = Thread(
            target=self._run_writer,
            name="campus-supervisor-audit-writer",
            daemon=True,
        )
        self._writer.start()

    def submit(self, record: SupervisorAuditRecord) -> None:
        try:
            self._queue.put_nowait(record)
        except Full:
            with self._lock:
                self._dropped_count += 1

    def flush(self, *, timeout_seconds: float = 1.0) -> bool:
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        while time.monotonic() <= deadline:
            if self._queue.unfinished_tasks == 0:
                return True
            time.sleep(0.01)
        return self._queue.unfinished_tasks == 0

    def close(self, *, timeout_seconds: float = 1.0) -> None:
        self.flush(timeout_seconds=timeout_seconds)
        self._stop_requested.set()
        self._writer.join(timeout=max(timeout_seconds, 0.0))

    def status(self) -> AuditRuntimeStatus:
        with self._lock:
            dropped_count = self._dropped_count
            last_error = self._last_error
        writer_alive = self._writer.is_alive()
        healthy = writer_alive and not last_error and dropped_count == 0
        return AuditRuntimeStatus(
            healthy=healthy,
            queue_depth=self._queue.qsize(),
            queue_capacity=self.queue_capacity,
            dropped_count=dropped_count,
            writer_alive=writer_alive,
            last_error=last_error,
        )

    def _run_writer(self) -> None:
        while not self._stop_requested.is_set() or self._queue.unfinished_tasks:
            try:
                record = self._queue.get(timeout=0.05)
            except Empty:
                continue
            try:
                _write_jsonl_audit_record(self.path, record)
            except AuditSinkError as exc:
                with self._lock:
                    self._last_error = str(exc)
            finally:
                self._queue.task_done()


def _write_jsonl_audit_record(path: Path, record: SupervisorAuditRecord) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "recorded_at": datetime.now(UTC).isoformat(),
            **asdict(record),
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True, sort_keys=True))
            handle.write("\n")
    except OSError as exc:
        raise AuditSinkError(f"failed to write audit log: {path}") from exc
