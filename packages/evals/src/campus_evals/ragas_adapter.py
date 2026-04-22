from __future__ import annotations

from typing import Callable

from campus_evals.models import ExecutionResult, GoldenCase, SupplementalResult
from campus_evals.ragas_adapter_metrics import (
    _configure_metric_runtime,
    _resolve_metric_entries,
    build_default_ragas_metric_names,
    build_default_ragas_metrics,
)
from campus_evals.ragas_adapter_projection import (
    RagasProjection,
    _build_metric_applicability,
    _require_supported_response,
    build_ragas_dataset,
    build_ragas_projection,
)
from campus_evals.ragas_adapter_results import (
    _attach_case_metadata,
    _build_failed_result,
    _build_not_applicable_result,
    _build_runtime_failed_supplemental_result,
    _build_supplemental_result,
    _extract_metric_value,
    _extract_ragas_score_row,
    _runtime_failure_metadata,
)
from campus_evals.runtime_observability import bind_runtime_event_context
from campus_evals.settings import RagasSettings, SupplementalHTTPSettings
from campus_evals.supplemental_http import (
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    format_runtime_exception_message,
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

    def evaluate(
        self, case: GoldenCase, execution: ExecutionResult
    ) -> tuple[SupplementalResult, ...]:
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
        if self._metric_names and not any(
            metric_applicability.get(metric_name, True) for metric_name in self._metric_names
        ):
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
            return tuple(
                _attach_case_metadata(result=result, case=case, response=response)
                for result in results
            )

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
                    from campus_evals.faithfulness_runtime import (
                        execute_staged_faithfulness,
                        supports_staged_faithfulness,
                    )

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
                                    "ragas_metric_name": str(
                                        getattr(metric, "name", entry.requested_name)
                                    ),
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
                            value=_extract_metric_value(
                                row, requested_name=entry.requested_name, actual_name=metric.name
                            ),
                            projection=projection,
                            metadata={
                                "ragas_metric_name": str(
                                    getattr(metric, "name", entry.requested_name)
                                ),
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


def build_ragas_supplemental_adapter_from_env(
    env: dict[str, str] | None = None,
    *,
    metric_names: tuple[str, ...] | None = None,
    http_settings: SupplementalHTTPSettings | None = None,
    faithfulness_nli_batch_size: int = 4,
) -> RagasSupplementalAdapter:
    settings = RagasSettings.from_env(
        env,
        http_settings=http_settings,
        faithfulness_nli_batch_size=faithfulness_nli_batch_size,
    )
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
