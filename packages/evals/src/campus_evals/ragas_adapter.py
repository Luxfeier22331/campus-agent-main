from __future__ import annotations

from dataclasses import dataclass, field
from math import isnan
import time
from typing import Callable

from campus_contracts import RagResultPayload, SpecialistResponse
from campus_evals.models import ExecutionResult, GoldenCase, SupplementalResult
from campus_evals.ragas_http import (
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    is_retryable_provider_exception,
)
from campus_evals.settings import RagasSettings


DEFAULT_RAGAS_METRIC_NAMES = ("faithfulness", "answer_relevancy", "context_precision", "context_recall")
DEFAULT_RAGAS_SCORE_ATTEMPTS = 3
DEFAULT_RAGAS_SCORE_BACKOFF_SECONDS = 2.0


@dataclass(frozen=True, slots=True)
class RagasProjection:
    case_id: str
    user_input: str
    response: str
    retrieved_contexts: tuple[str, ...]
    reference: str
    metadata: dict[str, object] = field(default_factory=dict)


def build_ragas_projection(case: GoldenCase, execution: ExecutionResult) -> RagasProjection:
    response = execution.response
    if not isinstance(response, SpecialistResponse):
        raise TypeError("execution.response must be SpecialistResponse")
    evidence = response.result.evidence if isinstance(response.result, RagResultPayload) else None
    contexts = tuple(source.snippet for source in evidence.sources) if evidence is not None else ()
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
        },
    )


class RagasSupplementalAdapter:
    adapter_id = "ragas"

    def __init__(
        self,
        *,
        scorer: Callable[[RagasProjection], tuple[SupplementalResult, ...]],
    ) -> None:
        self._scorer = scorer

    def evaluate(self, case: GoldenCase, execution: ExecutionResult) -> tuple[SupplementalResult, ...]:
        projection = build_ragas_projection(case, execution)
        results = self._scorer(projection)
        return tuple(results)


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
    from ragas.metrics import AnswerRelevancy, ContextPrecision, ContextRecall, Faithfulness

    return (
        Faithfulness(),
        AnswerRelevancy(),
        ContextPrecision(),
        ContextRecall(),
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
    metrics = list(metric_factory(llm, embeddings))
    run_config = RunConfig(
        timeout=int(settings.request_timeout_seconds),
        max_retries=1,
        max_workers=1,
    )

    def _score(projection: RagasProjection) -> tuple[SupplementalResult, ...]:
        evaluation = _evaluate_with_retries(
            evaluate_fn=evaluate_fn,
            projection=projection,
            metrics=metrics,
            llm=llm,
            embeddings=embeddings,
            run_config=run_config,
            batch_size=settings.batch_size,
        )
        row = _extract_ragas_score_row(evaluation)
        return tuple(_build_supplemental_result(metric_name=metric.name, value=row.get(metric.name), projection=projection) for metric in metrics)

    return _score


def build_ragas_supplemental_adapter_from_env(env: dict[str, str] | None = None) -> RagasSupplementalAdapter:
    return RagasSupplementalAdapter(scorer=build_ragas_scorer(RagasSettings.from_env(env)))


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
) -> SupplementalResult:
    score = _coerce_score(value)
    if score is None:
        return SupplementalResult(
            adapter_id="ragas",
            metric_name=metric_name,
            verdict="not_applicable",
            rationale=f"ragas metric {metric_name} did not return a numeric score",
            metadata={"case_id": projection.case_id},
        )
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=score,
        rationale=f"ragas metric {metric_name} scored projection {projection.case_id}",
        metadata={"case_id": projection.case_id},
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


def _evaluate_with_retries(
    *,
    evaluate_fn,
    projection: RagasProjection,
    metrics: list[object],
    llm: object,
    embeddings: object,
    run_config,
    batch_size: int | None,
):
    for attempt in range(1, DEFAULT_RAGAS_SCORE_ATTEMPTS + 1):
        try:
            return evaluate_fn(
                dataset=build_ragas_dataset(projection),
                metrics=metrics,
                llm=llm,
                embeddings=embeddings,
                run_config=run_config,
                show_progress=False,
                raise_exceptions=True,
                batch_size=batch_size,
            )
        except Exception as exc:
            if attempt >= DEFAULT_RAGAS_SCORE_ATTEMPTS or not _is_retryable_ragas_exception(exc):
                raise
            time.sleep(DEFAULT_RAGAS_SCORE_BACKOFF_SECONDS * attempt)
    raise RuntimeError("unreachable ragas retry loop")


def _is_retryable_ragas_exception(exc: Exception) -> bool:
    return isinstance(exc, TimeoutError) or is_retryable_provider_exception(exc)
