from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from campus_evals.settings import RagasSettings

if TYPE_CHECKING:
    from campus_evals.ragas_adapter_projection import RagasProjection

DEFAULT_RAGAS_METRIC_NAMES = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)
_PROMPT_ADAPTATION_CACHE: dict[tuple[str, str, str, bool], object] = {}


@dataclass(frozen=True, slots=True)
class _MetricExecutionEntry:
    requested_name: str
    metric: object


def build_default_ragas_metric_names() -> tuple[str, ...]:
    return DEFAULT_RAGAS_METRIC_NAMES


def build_default_ragas_metrics(
    llm: object,
    embeddings: object,
    *,
    metric_names: tuple[str, ...] | None = None,
    projection: RagasProjection | None = None,
    settings: RagasSettings | None = None,
):
    from ragas.metrics._answer_relevance import AnswerRelevancy
    from ragas.metrics._context_precision import ContextPrecision
    from ragas.metrics._context_recall import ContextRecall
    from ragas.metrics._faithfulness import Faithfulness

    resolved_metric_names = tuple(metric_names or build_default_ragas_metric_names())
    use_id_based_context_metrics = bool(
        projection and projection.retrieved_context_ids and projection.reference_context_ids
    )
    id_based_context_precision_builder, id_based_context_recall_builder = (
        _load_id_based_context_metric_builders()
    )
    builders = {
        "faithfulness": lambda: Faithfulness(llm=llm),
        "answer_relevancy": lambda: AnswerRelevancy(llm=llm, embeddings=embeddings, strictness=1),
        "context_precision": (
            id_based_context_precision_builder
            if use_id_based_context_metrics and id_based_context_precision_builder is not None
            else (lambda: ContextPrecision(llm=llm))
        ),
        "context_recall": (
            id_based_context_recall_builder
            if use_id_based_context_metrics and id_based_context_recall_builder is not None
            else (lambda: ContextRecall(llm=llm))
        ),
    }
    metrics = tuple(builders[name]() for name in resolved_metric_names if name in builders)
    if settings is None or settings.target_language is None:
        return metrics
    return tuple(
        _apply_metric_language_adaptation(metric, llm=llm, settings=settings) for metric in metrics
    )


def _load_id_based_context_metric_builders() -> tuple[
    Callable[[], object] | None,
    Callable[[], object] | None,
]:
    try:
        from ragas.metrics._context_precision import IDBasedContextPrecision
        from ragas.metrics._context_recall import IDBasedContextRecall
    except ImportError:
        return None, None
    return (lambda: IDBasedContextPrecision()), (lambda: IDBasedContextRecall())


def _apply_metric_language_adaptation(
    metric: object,
    *,
    llm: object,
    settings: RagasSettings,
) -> object:
    target_language = (settings.target_language or "").strip()
    if not target_language:
        return metric
    metric_name = str(getattr(metric, "name", "")).strip()
    prompt_specs: tuple[tuple[str, object | None], ...]
    if metric_name == "answer_relevancy":
        prompt_specs = (("question_generation", getattr(metric, "question_generation", None)),)
    elif metric_name == "faithfulness":
        prompt_specs = (
            ("statement_generator_prompt", getattr(metric, "statement_generator_prompt", None)),
            ("nli_statement_prompt", getattr(metric, "nli_statement_prompt", None)),
        )
    else:
        prompt_specs = ()
    for prompt_name, prompt in prompt_specs:
        if prompt is None or not hasattr(prompt, "adapt"):
            continue
        setattr(
            metric,
            prompt_name,
            _resolve_adapted_prompt(
                metric_name=metric_name,
                prompt_name=prompt_name,
                prompt=prompt,
                llm=llm,
                settings=settings,
            ),
        )
    return metric


def _resolve_adapted_prompt(
    *,
    metric_name: str,
    prompt_name: str,
    prompt: object,
    llm: object,
    settings: RagasSettings,
) -> object:
    target_language = str(settings.target_language or "").strip()
    cache_key = (metric_name, prompt_name, target_language, settings.adapt_instruction)
    cached = _PROMPT_ADAPTATION_CACHE.get(cache_key)
    if cached is not None:
        return cached
    adapted = _run_prompt_adaptation(
        prompt.adapt(
            target_language=target_language,
            llm=llm,
            adapt_instruction=settings.adapt_instruction,
        )
    )
    _PROMPT_ADAPTATION_CACHE[cache_key] = adapted
    return adapted


def _run_prompt_adaptation(result: object) -> object:
    if inspect.isawaitable(result):
        return asyncio.run(result)
    return result


def _resolve_metric_entries(
    metric_factory: Callable[..., tuple[object, ...]],
    *,
    llm: object,
    embeddings: object,
    projection: RagasProjection,
    settings: RagasSettings,
    metric_names: tuple[str, ...] | None,
) -> tuple[_MetricExecutionEntry, ...]:
    resolved_metric_names = tuple(metric_names or ())
    factory_kwargs: dict[str, object] = {}
    if resolved_metric_names and _metric_factory_accepts_argument(metric_factory, "metric_names"):
        factory_kwargs["metric_names"] = resolved_metric_names
    if _metric_factory_accepts_argument(metric_factory, "projection"):
        factory_kwargs["projection"] = projection
    if _metric_factory_accepts_argument(metric_factory, "settings"):
        factory_kwargs["settings"] = settings
    metrics = tuple(metric_factory(llm, embeddings, **factory_kwargs))
    if not resolved_metric_names:
        return tuple(
            _MetricExecutionEntry(
                requested_name=str(getattr(metric, "name", "")),
                metric=metric,
            )
            for metric in metrics
        )
    if len(metrics) == len(resolved_metric_names):
        return tuple(
            _MetricExecutionEntry(
                requested_name=resolved_metric_names[index],
                metric=metric,
            )
            for index, metric in enumerate(metrics)
        )

    by_actual_name = {
        str(getattr(metric, "name", "")): metric
        for metric in metrics
        if str(getattr(metric, "name", "")).strip()
    }
    entries: list[_MetricExecutionEntry] = []
    for requested_name in resolved_metric_names:
        actual_name = _actual_metric_name_for_requested_name(requested_name, projection=projection)
        metric = by_actual_name.get(actual_name) or by_actual_name.get(requested_name)
        if metric is None:
            continue
        entries.append(
            _MetricExecutionEntry(
                requested_name=requested_name,
                metric=metric,
            )
        )
    return tuple(entries)


def _metric_factory_accepts_argument(
    metric_factory: Callable[..., tuple[object, ...]],
    argument_name: str,
) -> bool:
    try:
        signature = inspect.signature(metric_factory)
    except (TypeError, ValueError):
        return False
    for parameter in signature.parameters.values():
        if parameter.kind == inspect.Parameter.VAR_KEYWORD:
            return True
        if parameter.name == argument_name:
            return True
    return False


def _actual_metric_name_for_requested_name(
    requested_name: str,
    *,
    projection: RagasProjection,
) -> str:
    if (
        requested_name == "context_precision"
        and projection.retrieved_context_ids
        and projection.reference_context_ids
    ):
        return "id_based_context_precision"
    if (
        requested_name == "context_recall"
        and projection.retrieved_context_ids
        and projection.reference_context_ids
    ):
        return "id_based_context_recall"
    return requested_name


def _configure_metric_runtime(metric: object, *, settings: RagasSettings) -> None:
    if str(getattr(metric, "name", "")) != "faithfulness":
        return
    metric._campus_stage_http_settings = {
        "statement_generation": settings.http_settings_for_metric_stage(
            metric_name="faithfulness",
            stage_name="statement_generation",
        ),
        "nli_verdicts": settings.http_settings_for_metric_stage(
            metric_name="faithfulness",
            stage_name="nli_verdicts",
        ),
    }
    metric._campus_faithfulness_nli_batch_size = settings.faithfulness_nli_batch_size
