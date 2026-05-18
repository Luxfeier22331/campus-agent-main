# ruff: noqa: F403
from __future__ import annotations

from .regulation_semantic_registry_actions import *
from .regulation_semantic_registry_answer_roles import *
from .regulation_semantic_registry_answer_rules import *
from .regulation_semantic_registry_base import *
from .regulation_semantic_registry_condition_rules import *
from .regulation_semantic_registry_conditions import *
from .regulation_semantic_registry_config import *
from .regulation_semantic_registry_intro import *
from .regulation_semantic_registry_procedure_rules import *
from .regulation_semantic_registry_types import *


def _load_student_rules_query_planning_config() -> dict[str, object]:
    from .regulation_semantic_registry_config import _load_student_rules_query_planning_config_impl

    return _load_student_rules_query_planning_config_impl()


__all__ = [name for name in globals() if not name.startswith("_")]
