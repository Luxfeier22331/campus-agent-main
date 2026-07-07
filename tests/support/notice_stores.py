from __future__ import annotations


class UnsupportedPersistentStore:
    def __init__(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("persistent Python store implementation has been removed")


__all__ = [
    "UnsupportedPersistentStore",
]
