from __future__ import annotations


def retrieve_sources(query: str) -> tuple[str, ...]:
    normalized = "-".join(part for part in query.strip().lower().split() if part)
    if not normalized:
        return ()
    return (f"kb://student_handbook/{normalized}",)
