from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CiWorkflowContractIssue:
    path: str
    message: str
