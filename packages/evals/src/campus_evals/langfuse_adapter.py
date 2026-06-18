from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class LangfuseAdapterDisabled(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LangfuseAdapterSettings:
    base_url: str = ""
    public_key: str = ""
    secret_key: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.base_url.strip() and self.public_key.strip() and self.secret_key.strip())


class LangfuseEvalAdapter(Protocol):
    def publish_scores(self, scores: object) -> None: ...


class DisabledLangfuseEvalAdapter:
    def publish_scores(self, scores: object) -> None:
        raise LangfuseAdapterDisabled("Langfuse adapter is disabled")


class ConfiguredLangfuseEvalAdapter:
    def __init__(self, settings: LangfuseAdapterSettings) -> None:
        self.settings = settings

    def publish_scores(self, scores: object) -> None:
        raise NotImplementedError("Langfuse score publishing is not implemented in the skeleton")


def create_langfuse_adapter(settings: LangfuseAdapterSettings) -> LangfuseEvalAdapter:
    populated = [
        bool(settings.base_url.strip()),
        bool(settings.public_key.strip()),
        bool(settings.secret_key.strip()),
    ]
    if any(populated) and not all(populated):
        raise ValueError("Langfuse adapter requires base URL, public and secret keys")
    if not settings.enabled:
        return DisabledLangfuseEvalAdapter()
    return ConfiguredLangfuseEvalAdapter(settings)


__all__ = [
    "ConfiguredLangfuseEvalAdapter",
    "DisabledLangfuseEvalAdapter",
    "LangfuseAdapterDisabled",
    "LangfuseAdapterSettings",
    "LangfuseEvalAdapter",
    "create_langfuse_adapter",
]
