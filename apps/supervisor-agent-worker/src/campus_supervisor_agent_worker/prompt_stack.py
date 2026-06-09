from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_knowledge_capability.prompt_packets import RagPromptPacket
from campus_knowledge_capability.prompts.registry import get_rag_prompt_spec
from campus_prompt_runtime import (
    REPO_GLOBAL_DEVELOPER_INVARIANTS_ID,
    REPO_GLOBAL_DEVELOPER_INVARIANTS_VERSION,
    get_repo_global_developer_invariants_text,
    serialize_prompt_payload,
)

PromptMessageRole = Literal["developer", "user"]
PromptMessageZone = Literal[
    "repo_global_developer_invariants",
    "package_role_prompt",
    "trusted_task_packet",
    "untrusted_user_input",
    "untrusted_evidence_packet",
]


@dataclass(frozen=True, slots=True)
class PromptRuntimeSettings:
    provider: str = ""
    transport: str = "responses"
    supervisor_prompt_model: str = ""
    agent_prompt_model: str = ""
    developer_invariants_id: str = REPO_GLOBAL_DEVELOPER_INVARIANTS_ID
    developer_invariants_version: str = REPO_GLOBAL_DEVELOPER_INVARIANTS_VERSION
    strict_structured_outputs: bool = True
    admitted: bool = False
    admission_reason: str = ""


@dataclass(frozen=True, slots=True)
class PromptStackMessage:
    role: PromptMessageRole
    zone: PromptMessageZone
    content: str


@dataclass(frozen=True, slots=True)
class PromptStackAssembly:
    prompt_id: str
    owner_package: str
    output_schema_name: str
    model_provider: str
    model_name: str
    template_sha256: str
    variables_schema_version: str
    output_schema_version: str
    messages: tuple[PromptStackMessage, ...]


def build_rag_prompt_stack(
    packet: RagPromptPacket,
    *,
    provider: str,
    model_name: str,
) -> PromptStackAssembly:
    spec = get_rag_prompt_spec(packet.prompt_id)
    messages = [
        PromptStackMessage(
            role="developer",
            zone="repo_global_developer_invariants",
            content=get_repo_global_developer_invariants_text(),
        ),
        PromptStackMessage(
            role="developer",
            zone="package_role_prompt",
            content=spec.template_text,
        ),
        PromptStackMessage(
            role="developer",
            zone="trusted_task_packet",
            content=serialize_prompt_payload(packet.task),
        ),
        PromptStackMessage(
            role="user",
            zone="untrusted_user_input",
            content=serialize_prompt_payload({"user_input_text": packet.user_input_text}),
        ),
    ]
    if packet.evidence:
        messages.append(
            PromptStackMessage(
                role="user",
                zone="untrusted_evidence_packet",
                content=serialize_prompt_payload({"evidence": packet.evidence}),
            )
        )
    return PromptStackAssembly(
        prompt_id=spec.prompt_id,
        owner_package=spec.owner_package,
        output_schema_name=packet.task.output_schema_name,
        model_provider=provider,
        model_name=model_name,
        template_sha256=spec.template_sha256,
        variables_schema_version=spec.variables_schema_version,
        output_schema_version=spec.output_schema_version,
        messages=tuple(messages),
    )


__all__ = [
    "PromptRuntimeSettings",
    "PromptStackAssembly",
    "PromptStackMessage",
    "build_rag_prompt_stack",
]
