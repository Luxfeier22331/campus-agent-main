from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ToolInvocation:
    name: str
    arguments: dict[str, object]
    call_id: str = ""
    output_projection_refs: tuple[dict[str, object], ...] = field(default_factory=tuple)
