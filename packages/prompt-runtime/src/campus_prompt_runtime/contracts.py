from __future__ import annotations

from typing import Literal, Protocol, TypeVar

from pydantic import BaseModel

PromptRuntimeTransport = Literal["responses"]
StructuredOutputModel = TypeVar("StructuredOutputModel", bound=BaseModel)


class PromptSpecLike(Protocol):
    prompt_id: str
    supported_modes: tuple[str, ...]
    variables_schema_version: str
    output_schema_version: str
    template_sha256: str


class PromptTaskLike(Protocol):
    mode: str
    output_schema_name: str


class PromptPacketLike(Protocol):
    prompt_id: str
    task: PromptTaskLike


class PromptMessageLike(Protocol):
    role: str
    content: str


class PromptStackLike(Protocol):
    prompt_id: str
    model_provider: str
    model_name: str
    messages: tuple[PromptMessageLike, ...]
