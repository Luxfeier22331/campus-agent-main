from __future__ import annotations

from collections.abc import Callable


def profile_fixture_smoke_loaders() -> tuple[tuple[str, Callable[[], object]], ...]:
    return (
        ("online-answer-path", _load_online_answer_path_smoke),
        ("tool-routing-product-path", _load_tool_routing_smoke),
        ("answer-quality-contract", _load_answer_quality_smoke),
        ("hindsight-memory-product-path", _load_hindsight_memory_product_path_smoke),
    )


def _load_online_answer_path_smoke() -> object:
    from campus_evals.online_answer_path_eval import load_online_answer_path_cases

    return load_online_answer_path_cases()


def _load_tool_routing_smoke() -> object:
    from campus_evals.tool_routing_product_path import load_tool_routing_cases

    return load_tool_routing_cases()


def _load_answer_quality_smoke() -> object:
    from campus_evals.answer_quality_contract import load_answer_quality_cases

    return load_answer_quality_cases()


def _load_hindsight_memory_product_path_smoke() -> object:
    from campus_evals.hindsight_memory_product_path import load_hindsight_memory_cases

    return load_hindsight_memory_cases()


__all__ = ["profile_fixture_smoke_loaders"]
