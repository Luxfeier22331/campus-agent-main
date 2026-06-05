from __future__ import annotations

from importlib import import_module
from typing import Any

from .answer_ready_evidence_contract import *  # noqa: F403
from .regulation_semantic_patterns import *  # noqa: F403
from .regulation_semantic_registry import *  # noqa: F403

_SUBMODULES = {
    "answer_ready_evidence_contract",
    "regulation_semantic_patterns",
    "regulation_semantic_registry",
    "regulation_semantic_registry_actions",
    "regulation_semantic_registry_answer_roles",
    "regulation_semantic_registry_answer_rules",
    "regulation_semantic_registry_base",
    "regulation_semantic_registry_condition_rules",
    "regulation_semantic_registry_conditions",
    "regulation_semantic_registry_config",
    "regulation_semantic_registry_intro",
    "regulation_semantic_registry_predicates",
    "regulation_semantic_registry_procedure_rules",
    "regulation_semantic_registry_types",
}

__all__ = tuple(
    name
    for name in globals()
    if not name.startswith("_") and name not in {"annotations", "Any", "import_module"}
)


def __getattr__(name: str) -> Any:
    if name not in _SUBMODULES:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(f"{__name__}.{name}")
    globals()[name] = module
    return module
