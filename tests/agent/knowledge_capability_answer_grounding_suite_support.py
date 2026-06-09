# ruff: noqa: F401
from __future__ import annotations

from dataclasses import replace

from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.knowledge_capability_test_support import *  # noqa: F403

__all__ = [name for name in globals() if not name.startswith("__")]
