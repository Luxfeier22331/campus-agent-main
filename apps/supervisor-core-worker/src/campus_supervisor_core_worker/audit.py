from __future__ import annotations

from collections.abc import Callable

from campus_supervisor_core import SupervisorAuditRecord

AuditSink = Callable[[SupervisorAuditRecord], None]


class AuditSinkError(RuntimeError):
    pass
