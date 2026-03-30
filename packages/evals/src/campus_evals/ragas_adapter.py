from __future__ import annotations

from dataclasses import dataclass, field
from math import isnan
from typing import Callable

from campus_contracts import RagResultPayload, SpecialistResponse, SupervisorResponse
from campus_evals.faithfulness_runtime import (
    execute_staged_faithfulness,
    supports_staged_faithfulness,
)
from campus_evals.models import ExecutionResult, GoldenCase, SupplementalResult
from campus_evals.runtime_observability import bind_runtime_event_context
from campus_evals.supplemental_http import (
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    format_runtime_exception_message,
)
from campus_evals.settings import RagasSettings, SupplementalHTTPSettings


DEFAULT_RAGAS_METRIC_NAMES = ("faithfulness", "answer_relevancy", "context_precision", "context_recall")


@dataclass(frozen=True, slots=True)
class RagasProjection:
    case_id: str
    user_input: str
    response: str
    retrieved_contexts: tuple[str, ...]
    reference: str
    metadata: dict[str, object] = field(default_factory=dict)


def build_ragas_projection(case: GoldenCase, execution: ExecutionResult) -> RagasProjection:
    response = _require_supported_response(execution)
    evidence = response.result.evidence if isinstance(response.result, RagResultPayload) else None
    contexts = tuple(source.snippet for source in evidence.sources) if evidence is not None else ()
    observed_trace = execution.observed_trace
    reference = "\n".join(case.required_facts).strip()
    return RagasProjection(
        case_id=case.case_id,
        user_input=case.user_goal,
        response=response.answer_text,
        retrieved_contexts=contexts,
        reference=reference,
        metadata={
            "expected_status": case.expected_status,
            "corpus": case.scope.corpus,
            "collection": case.scope.collection,
            "response_status": response.status,
            "retrieved_source_count": len(observed_trace.retrieved_sources) if observed_trace is not None else 0,
            "supporting_source_count": len(observed_trace.supporting_sources) if observed_trace is not None else len(contexts),
        },
    )


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
        if case.expected_status != "completed":
            return tuple(
                _build_not_applicable_result(
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale="completed-only metric",
                )
                for metric_name in self._metric_names
            )
        if response.status != "completed":
            return tuple(
                _build_failed_result(
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale=f"expected completed response but got {response.status}",
                    score=0.0,
                )
                for metric_name in self._metric_names
            )
        projection = build_ragas_projection(case, execution)
        try:
            results = tuple(self._scorer(projection))
        except Exception as exc:
            if not self._metric_names:
                raise
            return tuple(
                _build_failed_result(
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale=f"ragas runtime error: {format_runtime_exception_message(exc)}",
                    score=None,
                    metadata=_runtime_failure_metadata(exc),
                )
                for metric_name in self._metric_names
            )

        if not self._metric_names:
            return tuple(_attach_case_metadata(result=result, case=case, response=response) for result in results)

        by_metric_name = {result.metric_name: result for result in results}
        final_results: list[SupplementalResult] = []
        for metric_name in self._metric_names:
            result = by_metric_name.get(metric_name)
            if result is None:
                final_results.append(
                    _build_not_applicable_result(
                        metric_name=metric_name,
                        case=case,
                        response=response,
                        rationale=f"ragas scorer did not return metric {metric_name}",
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
                response=projection.response,
                reference=projection.reference,
            )
        ],
        name=projection.case_id,
    )


def build_default_ragas_metrics(llm: object, embeddings: object):
    from ragas.metrics._answer_relevance import AnswerRelevancy
    from ragas.metrics._context_precision import ContextPrecision
    from ragas.metrics._context_recall import ContextRecall
    from ragas.metrics._faithfulness import Faithfulness

    return (
        Faithfulness(llm=llm),
        AnswerRelevancy(llm=llm, embeddings=embeddings, strictness=1),
        ContextPrecision(llm=llm),
        ContextRecall(llm=llm),
    )


def build_ragas_scorer(
    settings: RagasSettings,
    *,
    evaluate_fn=None,
    llm_factory: Callable[[RagasSettings], object] = build_http_ragas_llm,
    embeddings_factory: Callable[[RagasSettings], object] = build_http_ragas_embeddings,
    metric_factory: Callable[[object, object], tuple[object, ...]] = build_default_ragas_metrics,
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
        for metric in metric_factory(llm, embeddings):
            with bind_runtime_event_context(adapter_id="ragas", metric_name=metric.name):
                try:
                    if supports_staged_faithfulness(metric):
                        staged = execute_staged_faithfulness(
                            metric=metric,
                            projection=projection,
                            run_config=run_config,
                        )
                        results.append(
                            _build_supplemental_result(
                                metric_name=metric.name,
                                value=staged.value,
                                projection=projection,
                                metadata=staged.metadata,
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
                            metric_name=metric.name,
                            value=row.get(metric.name),
                            projection=projection,
                        )
                    )
                except Exception as exc:
                    results.append(
                        _build_runtime_failed_supplemental_result(
                            metric_name=metric.name,
                            projection=projection,
                            exc=exc,
                        )
                    )
        return tuple(results)

    return _score


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
            **dict(result.metadata),
        },
    )


def _build_not_applicable_result(
    *,
    metric_name: str,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
    rationale: str,
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
