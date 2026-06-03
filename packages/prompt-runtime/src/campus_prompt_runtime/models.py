from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True, slots=True)
class NormalizedProviderGroundingSupport:
    claim_text: str
    support_source_doc_id: str = ""
    support_snippet: str = ""

    def __post_init__(self) -> None:
        if not self.claim_text.strip():
            raise ValueError("claim_text must not be empty")


@dataclass(frozen=True, slots=True)
class StructuredOutputExecutionResult[StructuredOutputResultT: BaseModel]:
    output: StructuredOutputResultT
    provider_grounding_supports: tuple[NormalizedProviderGroundingSupport, ...] = ()
