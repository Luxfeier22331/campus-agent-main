from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import inspect
from math import isnan
from typing import Callable

from campus_contracts import EvidenceBundle, RagResultPayload, SpecialistResponse, SupervisorResponse
from campus_evals.faithfulness_runtime import (
    execute_staged_faithfulness,
    supports_staged_faithfulness,
)
from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace, SupplementalResult
from campus_evals.runtime_observability import bind_runtime_event_context
from campus_evals.supplemental_http import (
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    format_runtime_exception_message,
)
from campus_evals.settings import RagasSettings, SupplementalHTTPSettings


DEFAULT_RAGAS_METRIC_NAMES = ("faithfulness", "answer_relevancy", "context_precision", "context_recall")
_PROMPT_ADAPTATION_CACHE: dict[tuple[str, str, str, bool], object] = {}


@dataclass(frozen=True, slots=True)
class RagasProjection:
    case_id: str
    user_input: str
    response: str
    retrieved_contexts: tuple[str, ...]
    reference: str
    retrieved_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_contexts: tuple[str, ...] = field(default_factory=tuple)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _MetricExecutionEntry:
    requested_name: str
    metric: object


def build_ragas_projection(case: GoldenCase, execution: ExecutionResult) -> RagasProjection:
    response = _require_supported_response(execution)
    evidence = response.result.evidence if isinstance(response.result, RagResultPayload) else None
    observed_trace = execution.observed_trace
    contexts, context_ids, context_source = _resolve_projection_contexts(
        case=case,
        observed_trace=observed_trace,
        evidence=evidence,
    )
    reference = "\n".join(case.reference_facts or case.required_facts).strip()
    reference_source_type = _reference_source_type(case)
    metric_applicability = _build_metric_applicability(case)
    return RagasProjection(
        case_id=case.case_id,
        user_input=case.user_goal,
        response=response.answer_text,
        retrieved_contexts=contexts,
        reference=reference,
        retrieved_context_ids=context_ids,
        reference_context_ids=case.reference_context_ids,
        reference_contexts=case.reference_contexts,
        metadata={
            "expected_status": case.expected_status,
            "corpus": case.scope.corpus,
            "collection": case.scope.collection,
            "response_status": response.status,
            "projection_context_source": context_source,
            "reference_source_type": reference_source_type,
            "reference_fact_count": len(case.reference_facts or case.required_facts),
            "metric_applicability": metric_applicability,
            "retrieved_source_count": len(observed_trace.retrieved_sources) if observed_trace is not None else 0,
            "supporting_source_count": len(observed_trace.supporting_sources) if observed_trace is not None else len(contexts),
        },
    )


def _resolve_projection_contexts(
    *,
    case: GoldenCase,
    observed_trace: ObservedTrace | None,
    evidence: EvidenceBundle | None,
) -> tuple[tuple[str, ...], tuple[str, ...], str]:
    supporting_evidence, supporting_source = _resolve_projection_evidence(
        case=case,
        observed_trace=observed_trace,
        evidence=evidence,
    )
    if supporting_evidence is not None and supporting_evidence.sources:
        statement_contexts, statement_context_ids = _build_statement_level_contexts(supporting_evidence)
        if statement_contexts:
            return statement_contexts, statement_context_ids, f"{supporting_source}:statement_contexts"
        return (
            tuple(source.snippet for source in supporting_evidence.sources),
            tuple(_source_projection_id(source) for source in supporting_evidence.sources),
            supporting_source,
        )
    if observed_trace is not None and observed_trace.retrieved_sources:
        return (
            tuple(source.snippet for source in observed_trace.retrieved_sources),
            tuple(_source_projection_id(source) for source in observed_trace.retrieved_sources),
            "observed_trace.retrieved_sources",
        )
    return (), (), "none"


def _resolve_projection_evidence(
    *,
    case: GoldenCase,
    observed_trace: ObservedTrace | None,
    evidence: EvidenceBundle | None,
) -> tuple[EvidenceBundle | None, str]:
    if observed_trace is not None and observed_trace.supporting_sources:
        return (
            EvidenceBundle(
                query_text=case.user_goal,
                corpus=case.scope.corpus,
                collection=case.scope.collection,
                sources=observed_trace.supporting_sources,
            ),
            "observed_trace.supporting_sources",
        )
    if evidence is not None and evidence.sources:
        return evidence, "response.evidence.sources"
    return None, "none"


def _build_statement_level_contexts(evidence: EvidenceBundle) -> tuple[tuple[str, ...], tuple[str, ...]]:
    try:
        from campus_rag_specialist import RagSpecialistAgent

        draft = RagSpecialistAgent().build_answer(evidence)
        return (
            draft.supporting_contexts,
            tuple(_source_projection_id(source) for source in draft.supporting_sources),
        )
    except Exception:
        return (), ()


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


def _reference_source_type(case: GoldenCase) -> str:
    if case.reference_context_ids:
        return "reference_context_ids"
    if case.reference_contexts:
        return "reference_contexts"
    if case.reference_facts:
        return "reference_facts"
    if case.required_facts:
        return "required_facts_fallback"
    return "none"


def _build_metric_applicability(
    case: GoldenCase,
    *,
    metric_names: tuple[str, ...] | None = None,
) -> dict[str, bool]:
    resolved_metric_names = tuple(metric_names or build_default_ragas_metric_names())
    return {
        metric_name: _is_metric_applicable(case, metric_name)
        for metric_name in resolved_metric_names
    }


def _is_metric_applicable(case: GoldenCase, metric_name: str) -> bool:
    override = case.supplemental_metric_overrides.get(metric_name)
    if override is not None:
        return override
    return True


class RagasSupplementalAdapter:
    adapter_id = "ragas"

    def __init__(
        self,
        *,
        scorer: Callable[[RagasProjection], tuple[SupplementalResult, ...]],
        metric_names: tuple[str, ...] | None = None,
        preflight: Callable[[], object] | None = None,
    ) -> None:
        self._scorer = scorer
        self._metric_names = tuple(metric_names or ())
        self._preflight = preflight

    @property
    def metric_names(self) -> tuple[str, ...]:
        return self._metric_names

    def evaluate(self, case: GoldenCase, execution: ExecutionResult) -> tuple[SupplementalResult, ...]:
        response = _require_supported_response(execution)
        metric_applicability = _build_metric_applicability(case, metric_names=self._metric_names)
        if case.expected_status != "completed":
            return tuple(
                _build_not_applicable_result(
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale="completed-only metric",
                    metric_applicable=metric_applicability.get(metric_name, True),
                )
                for metric_name in self._metric_names
            )
        if response.status != "completed":
            failed_results: list[SupplementalResult] = []
            for metric_name in self._metric_names:
                if not metric_applicability.get(metric_name, True):
                    failed_results.append(
                        _build_not_applicable_result(
                            metric_name=metric_name,
                            case=case,
                            response=response,
                            rationale="metric disabled by case supplemental_metric_overrides",
                            metric_applicable=False,
                        )
                    )
                    continue
                failed_results.append(
                    _build_failed_result(
                        metric_name=metric_name,
                        case=case,
                        response=response,
                        rationale=f"expected completed response but got {response.status}",
                        score=0.0,
                        metadata={"metric_applicable": True},
                    )
                )
            return tuple(failed_results)
        if self._metric_names and not any(metric_applicability.get(metric_name, True) for metric_name in self._metric_names):
            return tuple(
                _build_not_applicable_result(
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale="metric disabled by case supplemental_metric_overrides",
                    metric_applicable=False,
                )
                for metric_name in self._metric_names
            )
        projection = build_ragas_projection(case, execution)
        try:
            results = tuple(self._scorer(projection))
        except Exception as exc:
            if not self._metric_names:
                raise
            errored_results: list[SupplementalResult] = []
            for metric_name in self._metric_names:
                if not metric_applicability.get(metric_name, True):
                    errored_results.append(
                        _build_not_applicable_result(
                            metric_name=metric_name,
                            case=case,
                            response=response,
                            rationale="metric disabled by case supplemental_metric_overrides",
                            metric_applicable=False,
                        )
                    )
                    continue
                errored_results.append(
                    _build_failed_result(
                        metric_name=metric_name,
                        case=case,
                        response=response,
                        rationale=f"ragas runtime error: {format_runtime_exception_message(exc)}",
                        score=None,
                        metadata={
                            "metric_applicable": True,
                            **_runtime_failure_metadata(exc),
                        },
                    )
                )
            return tuple(errored_results)

        if not self._metric_names:
            return tuple(_attach_case_metadata(result=result, case=case, response=response) for result in results)

        by_metric_name = {result.metric_name: result for result in results}
        final_results: list[SupplementalResult] = []
        for metric_name in self._metric_names:
            if not metric_applicability.get(metric_name, True):
                final_results.append(
                    _build_not_applicable_result(
                        metric_name=metric_name,
                        case=case,
                        response=response,
                        rationale="metric disabled by case supplemental_metric_overrides",
                        metric_applicable=False,
                    )
                )
                continue
            result = by_metric_name.get(metric_name)
            if result is None:
                final_results.append(
                    _build_not_applicable_result(
                        metric_name=metric_name,
                        case=case,
                        response=response,
                        rationale=f"ragas scorer did not return metric {metric_name}",
                        metric_applicable=True,
                    )
                )
                continue
            final_results.append(_attach_case_metadata(result=result, case=case, response=response))
        return tuple(final_results)

    def preflight(self) -> object:
        if self._preflight is None:
            return {"status": "skipped"}
        return self._preflight()


def _require_supported_response(execution: ExecutionResult) -> SpecialistResponse | SupervisorResponse:
    response = execution.response
    if not isinstance(response, (SpecialistResponse, SupervisorResponse)):
        raise TypeError("execution.response must be SpecialistResponse or SupervisorResponse")
    return response


def build_default_ragas_metric_names() -> tuple[str, ...]:
    return DEFAULT_RAGAS_METRIC_NAMES


def build_ragas_dataset(projection: RagasProjection):
    from ragas import EvaluationDataset, SingleTurnSample

    return EvaluationDataset(
        samples=[
            SingleTurnSample(
                user_input=projection.user_input,
                retrieved_contexts=list(projection.retrieved_contexts),
                reference_contexts=list(projection.reference_contexts),
                retrieved_context_ids=list(projection.retrieved_context_ids),
                reference_context_ids=list(projection.reference_context_ids),
                response=projection.response,
                reference=projection.reference,
            )
        ],
        name=projection.case_id,
    )


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
    use_id_based_context_metrics = bool(projection and projection.retrieved_context_ids and projection.reference_context_ids)
    id_based_context_precision_builder, id_based_context_recall_builder = _load_id_based_context_metric_builders()
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
    return tuple(_apply_metric_language_adaptation(metric, llm=llm, settings=settings) for metric in metrics)


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


def build_ragas_scorer(
    settings: RagasSettings,
    *,
    evaluate_fn=None,
    llm_factory: Callable[[RagasSettings], object] = build_http_ragas_llm,
    embeddings_factory: Callable[[RagasSettings], object] = build_http_ragas_embeddings,
    metric_factory: Callable[[object, object], tuple[object, ...]] = build_default_ragas_metrics,
    metric_names: tuple[str, ...] | None = None,
) -> Callable[[RagasProjection], tuple[SupplementalResult, ...]]:
    if evaluate_fn is None:
        from ragas import evaluate as evaluate_fn
    from ragas.run_config import RunConfig

    llm = llm_factory(settings)
    embeddings = embeddings_factory(settings)
    run_config = RunConfig(
        timeout=int(settings.request_timeout_seconds),
        max_retries=0,
        max_workers=1,
    )

    def _score(projection: RagasProjection) -> tuple[SupplementalResult, ...]:
        dataset = build_ragas_dataset(projection)
        results: list[SupplementalResult] = []
        metric_applicability = dict(projection.metadata.get("metric_applicability") or {})
        for entry in _resolve_metric_entries(
            metric_factory,
            llm=llm,
            embeddings=embeddings,
            projection=projection,
            settings=settings,
            metric_names=metric_names,
        ):
            if metric_applicability.get(entry.requested_name) is False:
                continue
            metric = entry.metric
            _configure_metric_runtime(metric, settings=settings)
            with bind_runtime_event_context(adapter_id="ragas", metric_name=entry.requested_name):
                try:
                    if supports_staged_faithfulness(metric):
                        staged = execute_staged_faithfulness(
                            metric=metric,
                            projection=projection,
                            run_config=run_config,
                        )
                        results.append(
                            _build_supplemental_result(
                                metric_name=entry.requested_name,
                                value=staged.value,
                                projection=projection,
                                metadata={
                                    "ragas_metric_name": str(getattr(metric, "name", entry.requested_name)),
                                    **staged.metadata,
                                },
                            )
                        )
                        continue
                    evaluation = evaluate_fn(
                        dataset=dataset,
                        metrics=[metric],
                        llm=llm,
                        embeddings=embeddings,
                        run_config=run_config,
                        show_progress=False,
                        raise_exceptions=True,
                    )
                    row = _extract_ragas_score_row(evaluation)
                    results.append(
                        _build_supplemental_result(
                            metric_name=entry.requested_name,
                            value=_extract_metric_value(row, requested_name=entry.requested_name, actual_name=metric.name),
                            projection=projection,
                            metadata={
                                "ragas_metric_name": str(getattr(metric, "name", entry.requested_name)),
                            },
                        )
                    )
                except Exception as exc:
                    results.append(
                        _build_runtime_failed_supplemental_result(
                            metric_name=entry.requested_name,
                            projection=projection,
                            exc=exc,
                        )
                    )
        return tuple(results)

    return _score


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
    if requested_name == "context_precision" and projection.retrieved_context_ids and projection.reference_context_ids:
        return "id_based_context_precision"
    if requested_name == "context_recall" and projection.retrieved_context_ids and projection.reference_context_ids:
        return "id_based_context_recall"
    return requested_name


def _configure_metric_runtime(metric: object, *, settings: RagasSettings) -> None:
    if str(getattr(metric, "name", "")) != "faithfulness":
        return
    setattr(
        metric,
        "_campus_stage_http_settings",
        {
            "statement_generation": settings.http_settings_for_metric_stage(
                metric_name="faithfulness",
                stage_name="statement_generation",
            ),
            "nli_verdicts": settings.http_settings_for_metric_stage(
                metric_name="faithfulness",
                stage_name="nli_verdicts",
            ),
        },
    )


def build_ragas_supplemental_adapter_from_env(
    env: dict[str, str] | None = None,
    *,
    metric_names: tuple[str, ...] | None = None,
    http_settings: SupplementalHTTPSettings | None = None,
) -> RagasSupplementalAdapter:
    settings = RagasSettings.from_env(env, http_settings=http_settings)
    llm = build_http_ragas_llm(settings)
    embeddings = build_http_ragas_embeddings(settings)
    resolved_metric_names = metric_names or build_default_ragas_metric_names()
    return RagasSupplementalAdapter(
        scorer=build_ragas_scorer(
            settings,
            llm_factory=lambda resolved: llm,
            embeddings_factory=lambda resolved: embeddings,
            metric_names=resolved_metric_names,
        ),
        metric_names=resolved_metric_names,
        preflight=lambda: {
            "llm": llm.preflight_sync(),
            "embeddings": embeddings.preflight_sync(),
        },
    )


def _extract_ragas_score_row(evaluation: object) -> dict[str, object]:
    scores = getattr(evaluation, "scores", None)
    if not isinstance(scores, list) or len(scores) != 1 or not isinstance(scores[0], dict):
        raise ValueError("ragas evaluation must return exactly one score row")
    return scores[0]


def _extract_metric_value(row: dict[str, object], *, requested_name: str, actual_name: str) -> object:
    if actual_name in row:
        return row.get(actual_name)
    return row.get(requested_name)


def _build_supplemental_result(
    *,
    metric_name: str,
    value: object,
    projection: RagasProjection,
    metadata: dict[str, object] | None = None,
) -> SupplementalResult:
    score = _coerce_score(value)
    if score is None:
        return SupplementalResult(
            adapter_id="ragas",
            metric_name=metric_name,
            verdict="not_applicable",
            rationale=f"ragas metric {metric_name} did not return a numeric score",
            metadata={
                "case_id": projection.case_id,
                **dict(metadata or {}),
            },
        )
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=score,
        rationale=f"ragas metric {metric_name} scored projection {projection.case_id}",
        metadata={
            "case_id": projection.case_id,
            "metric_applicable": True,
            **dict(metadata or {}),
        },
    )


def _build_runtime_failed_supplemental_result(
    *,
    metric_name: str,
    projection: RagasProjection,
    exc: Exception,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=None,
        verdict="failed",
        rationale=f"ragas runtime error: {format_runtime_exception_message(exc)}",
        metadata={
            "case_id": projection.case_id,
            "metric_applicable": True,
            **_runtime_failure_metadata(exc),
        },
    )


def _coerce_score(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        numeric = float(value)
        return None if isnan(numeric) else numeric
    return None


def _attach_case_metadata(
    *,
    result: SupplementalResult,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id=result.adapter_id,
        metric_name=result.metric_name,
        score=result.score,
        verdict=result.verdict,
        rationale=result.rationale,
        gating=result.gating,
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
            "metric_applicable": dict(result.metadata).get("metric_applicable", True),
            **dict(result.metadata),
        },
    )


def _build_not_applicable_result(
    *,
    metric_name: str,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
    rationale: str,
    metric_applicable: bool,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        verdict="not_applicable",
        rationale=rationale,
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
            "metric_applicable": metric_applicable,
        },
    )


def _build_failed_result(
    *,
    metric_name: str,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
    rationale: str,
    score: float | None,
    metadata: dict[str, object] | None = None,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=score,
        verdict="failed",
        rationale=rationale,
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
            **dict(metadata or {}),
        },
    )


def _runtime_failure_metadata(exc: Exception) -> dict[str, object]:
    metadata: dict[str, object] = {
        "judge_error": type(exc).__name__,
    }
    reasons = tuple(str(item) for item in getattr(exc, "reasons", ()) if str(item))
    if reasons:
        metadata["failure_reasons"] = list(reasons)
    disposition = getattr(exc, "disposition", None)
    if isinstance(disposition, str) and disposition.strip():
        metadata["failure_disposition"] = disposition
    for attr in (
        "provider_origin",
        "http_status",
        "request_id",
        "faithfulness_stage",
        "checkpoint_path",
        "source_checkpoint_path",
        "sample_hash",
        "statement_count",
        "completed_batch_count",
        "remaining_batch_count",
    ):
        value = getattr(exc, attr, None)
        if value not in (None, "", (), []):
            metadata[attr] = value
    return metadata
