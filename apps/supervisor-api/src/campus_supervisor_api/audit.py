from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from campus_supervisor_core import SupervisorAuditRecord

AuditSink = Callable[[SupervisorAuditRecord], None]


class AuditSinkError(RuntimeError):
    pass


def build_jsonl_audit_sink(path: Path) -> AuditSink:
    def sink(record: SupervisorAuditRecord) -> None:
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

    return sink
