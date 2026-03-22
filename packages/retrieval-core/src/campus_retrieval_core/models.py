from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query_text: str
    corpus: str = "student_handbook"
    campus_scope: str | None = None
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    top_k: int = 3

    def __post_init__(self) -> None:
        if self.corpus != "student_handbook":
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")
