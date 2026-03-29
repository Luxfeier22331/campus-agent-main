from __future__ import annotations

from dataclasses import dataclass, field
from math import isnan
from typing import Callable

from campus_contracts import RagResultPayload, SpecialistResponse, SupervisorResponse
from campus_evals.models import ExecutionResult, GoldenCase, SupplementalResult
from campus_evals.supplemental_http import (
    build_http_ragas_embeddings,
    build_http_ragas_llm,
)
from campus_evals.settings import RagasSettings


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
        preflight: Callable[[], object] | None = None,
    ) -> None:
        self._scorer = scorer
        self._preflight = preflight

    def evaluate(self, case: GoldenCase, execution: ExecutionResult) -> tuple[SupplementalResult, ...]:
        projection = build_ragas_projection(case, execution)
        results = self._scorer(projection)
        return tuple(results)

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
        max_retries=0,
        max_workers=1,
    )

    def _score(projection: RagasProjection) -> tuple[SupplementalResult, ...]:
        evaluation = evaluate_fn(
            dataset=build_ragas_dataset(projection),
            metrics=metrics,
            llm=llm,
            embeddings=embeddings,
            run_config=run_config,
            show_progress=False,
            raise_exceptions=True,
            batch_size=settings.batch_size,
        )
        row = _extract_ragas_score_row(evaluation)
        return tuple(_build_supplemental_result(metric_name=metric.name, value=row.get(metric.name), projection=projection) for metric in metrics)

    return _score


def build_ragas_supplemental_adapter_from_env(env: dict[str, str] | None = None) -> RagasSupplementalAdapter:
    settings = RagasSettings.from_env(env)
    llm = build_http_ragas_llm(settings)
    embeddings = build_http_ragas_embeddings(settings)
    return RagasSupplementalAdapter(
        scorer=build_ragas_scorer(
            settings,
            llm_factory=lambda resolved: llm,
            embeddings_factory=lambda resolved: embeddings,
        ),
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
