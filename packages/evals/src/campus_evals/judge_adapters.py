from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path

import httpx
from campus_contracts import CapabilityResponse, ExecutionResponse, RagResultPayload

from campus_evals._advisory_suppression import suppress_transformers_missing_torch_advisory

with suppress_transformers_missing_torch_advisory():
    from langchain_core.prompt_values import StringPromptValue

from campus_evals.models import ExecutionResult, GoldenCase, SupplementalResult
from campus_evals.ragas_adapter import (
    RagasSupplementalAdapter,
    build_default_ragas_metric_names,
    build_ragas_scorer,
)
from campus_evals.runtime_observability import bind_runtime_event_context
from campus_evals.settings import JudgeLLMSettings, RagasSettings
from campus_evals.supplemental_http import (
    OpenAICompatibleChatCompletionsLLM,
    OpenAICompatibleResponsesLLM,
    format_runtime_exception_message,
    get_provider_circuit_breaker,
    get_request_pacer,
)

JudgeFn = Callable[[str], dict[str, object]]
DEFAULT_STUDENT_HANDBOOK_JUDGE_RUBRICS_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "student_handbook_judge_rubrics.json"
)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)


HandbookRagasAdapter = RagasSupplementalAdapter


class RubricJudgeAdapter:
    adapter_id = "judge"

    def __init__(
        self,
        *,
        metric_name: str,
        applicable_statuses: tuple[str, ...],
        rubric: dict[str, object],
        judge_fn: JudgeFn,
        preflight: Callable[[], object] | None = None,
    ) -> None:
        self.metric_name = metric_name
        self._applicable_statuses = applicable_statuses
        self._rubric = rubric
        self._judge_fn = judge_fn
        self._preflight = preflight

    @property
    def metric_names(self) -> tuple[str, ...]:
        return (self.metric_name,)

    def evaluate(
        self, case: GoldenCase, execution: ExecutionResult
    ) -> tuple[SupplementalResult, ...]:
        response = _require_capability_response(execution)
        if case.expected_status not in self._applicable_statuses:
            return (
                _build_not_applicable_result(
                    adapter_id=self.adapter_id,
                    metric_name=self.metric_name,
                    case=case,
                    response=response,
                    rationale=f"{','.join(self._applicable_statuses)}-only metric",
                ),
            )
        if response.status != case.expected_status:
            return (
                _build_failed_result(
                    adapter_id=self.adapter_id,
                    metric_name=self.metric_name,
                    case=case,
                    response=response,
                    rationale=f"expected response status {case.expected_status} but got {response.status}",
                    score=0.0,
                ),
            )
        prompt = _build_rubric_prompt(
            rubric=self._rubric,
            case=case,
            response=response,
        )
        try:
            with bind_runtime_event_context(
                adapter_id=self.adapter_id, metric_name=self.metric_name
            ):
                judged = self._judge_fn(prompt)
        except Exception as exc:
            return (
                _build_failed_result(
                    adapter_id=self.adapter_id,
                    metric_name=self.metric_name,
                    case=case,
                    response=response,
                    rationale=f"judge runtime error: {format_runtime_exception_message(exc)}",
                    score=None,
                    metadata=_runtime_failure_metadata(exc),
                ),
            )
        return (
            _coerce_judge_result(
                adapter_id=self.adapter_id,
                metric_name=self.metric_name,
                case=case,
                response=response,
                judged=judged,
            ),
        )

    def preflight(self) -> object:
        if self._preflight is None:
            return {"status": "skipped"}
        return self._preflight()


def load_handbook_judge_rubrics(path: str | Path | None = None) -> dict[str, dict[str, object]]:
    resolved_path = Path(path) if path is not None else DEFAULT_STUDENT_HANDBOOK_JUDGE_RUBRICS_PATH
    payload = json.loads(resolved_path.read_text(encoding="utf-8"))
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("judge rubric schema_version must be 1")
    rubrics = payload.get("rubrics")
    if not isinstance(rubrics, list) or not rubrics:
        raise ValueError("judge rubric fixture must define rubrics")
    resolved: dict[str, dict[str, object]] = {}
    for item in rubrics:
        if not isinstance(item, dict):
            raise ValueError("judge rubric item must be an object")
        metric_name = str(item.get("metric_name") or "").strip()
        if not metric_name:
            raise ValueError("judge rubric metric_name is required")
        resolved[metric_name] = dict(item)
    return resolved


def build_handbook_ragas_adapter(
    settings: RagasSettings,
    *,
    scorer: Callable[[object], tuple[SupplementalResult, ...]] | None = None,
    metric_names: tuple[str, ...] | None = None,
    preflight: Callable[[], object] | None = None,
) -> HandbookRagasAdapter:
    resolved_metric_names = metric_names or build_default_ragas_metric_names()
    resolved_scorer = scorer
    resolved_preflight = preflight
    if resolved_scorer is None:
        from campus_evals.supplemental_http import build_http_ragas_embeddings, build_http_ragas_llm

        llm = build_http_ragas_llm(settings)
        embeddings = build_http_ragas_embeddings(settings)
        resolved_scorer = build_ragas_scorer(
            settings,
            llm_factory=lambda resolved: llm,
            embeddings_factory=lambda resolved: embeddings,
            metric_names=resolved_metric_names,
        )
        if resolved_preflight is None:

            def resolved_preflight():
                return {
                    "llm": llm.preflight_sync(),
                    "embeddings": embeddings.preflight_sync(),
                }

    return HandbookRagasAdapter(
        scorer=resolved_scorer,
        metric_names=resolved_metric_names,
        preflight=resolved_preflight,
    )


def build_answer_rubric_adapter(
    settings: JudgeLLMSettings,
    *,
    judge_fn: JudgeFn | None = None,
    rubrics_path: str | Path | None = None,
    sync_client: httpx.Client | None = None,
    preflight: Callable[[], object] | None = None,
) -> RubricJudgeAdapter:
    rubric = load_handbook_judge_rubrics(rubrics_path)["answer_correctness_rubric"]
    resolved_judge_fn = judge_fn
    resolved_preflight = preflight
    if resolved_judge_fn is None:
        _, resolved_judge_fn, resolved_preflight = _build_json_judge_runtime(
            settings,
            sync_client=sync_client,
        )
    return RubricJudgeAdapter(
        metric_name="answer_correctness_rubric",
        applicable_statuses=("completed",),
        rubric=rubric,
        judge_fn=resolved_judge_fn,
        preflight=resolved_preflight,
    )


def build_refusal_rubric_adapter(
    settings: JudgeLLMSettings,
    *,
    judge_fn: JudgeFn | None = None,
    rubrics_path: str | Path | None = None,
    sync_client: httpx.Client | None = None,
    preflight: Callable[[], object] | None = None,
) -> RubricJudgeAdapter:
    rubric = load_handbook_judge_rubrics(rubrics_path)["refusal_quality"]
    resolved_judge_fn = judge_fn
    resolved_preflight = preflight
    if resolved_judge_fn is None:
        _, resolved_judge_fn, resolved_preflight = _build_json_judge_runtime(
            settings,
            sync_client=sync_client,
        )
    return RubricJudgeAdapter(
        metric_name="refusal_quality",
        applicable_statuses=("no_answer", "needs_clarification"),
        rubric=rubric,
        judge_fn=resolved_judge_fn,
        preflight=resolved_preflight,
    )


def build_default_handbook_supplemental_adapters_from_env(
    env: dict[str, str] | None = None,
    *,
    metric_names: tuple[str, ...] | None = None,
    http_settings=None,
    faithfulness_nli_batch_size: int = 4,
) -> tuple[object, ...]:
    ragas_settings = RagasSettings.from_env(
        env,
        http_settings=http_settings,
        faithfulness_nli_batch_size=faithfulness_nli_batch_size,
    )
    judge_settings = JudgeLLMSettings.from_env(env, http_settings=http_settings)
    _, judge_fn, judge_preflight = _build_json_judge_runtime(judge_settings)
    return (
        build_handbook_ragas_adapter(ragas_settings, metric_names=metric_names),
        build_answer_rubric_adapter(judge_settings, judge_fn=judge_fn, preflight=judge_preflight),
        build_refusal_rubric_adapter(judge_settings, judge_fn=judge_fn, preflight=judge_preflight),
    )


def build_json_judge(
    settings: JudgeLLMSettings,
    *,
    sync_client: httpx.Client | None = None,
) -> JudgeFn:
    _, judge_fn, _ = _build_json_judge_runtime(settings, sync_client=sync_client)
    return judge_fn


def _build_json_judge_runtime(
    settings: JudgeLLMSettings,
    *,
    sync_client: httpx.Client | None = None,
) -> tuple[
    OpenAICompatibleResponsesLLM | OpenAICompatibleChatCompletionsLLM, JudgeFn, Callable[[], object]
]:
    base_url = settings.llm_base_url or "https://api.openai.com/v1"
    llm_kwargs = {
        "base_url": base_url,
        "api_key": settings.llm_api_key,
        "model": settings.llm_model,
        "http_settings": settings.http_settings,
        "reasoning_effort": settings.reasoning_effort,
        "text_verbosity": settings.text_verbosity,
        "max_output_tokens": settings.max_output_tokens,
        "request_pacer": get_request_pacer(
            base_url=base_url,
            api_key=settings.llm_api_key,
            min_interval_seconds=settings.http_settings.request_min_interval_seconds,
        ),
        "circuit_breaker": get_provider_circuit_breaker(
            base_url=base_url,
            api_key=settings.llm_api_key,
            settings=settings.http_settings,
        ),
        "sync_client": sync_client,
    }
    if settings.llm_transport == "chat_completions":
        llm = OpenAICompatibleChatCompletionsLLM(**llm_kwargs)
    else:
        llm = OpenAICompatibleResponsesLLM(**llm_kwargs)

    def _judge(prompt: str) -> dict[str, object]:
        result = llm.generate_text(StringPromptValue(text=prompt))
        text = result.generations[0][0].text
        return _parse_judge_json(text)

    preflight = getattr(llm, "preflight_sync", None)
    if not callable(preflight):

        def preflight():
            return {"status": "not_supported"}

    return llm, _judge, preflight


def _build_rubric_prompt(
    *,
    rubric: dict[str, object],
    case: GoldenCase,
    response: CapabilityResponse | ExecutionResponse,
) -> str:
    evidence = response.result.evidence if isinstance(response.result, RagResultPayload) else None
    sources = tuple(evidence.sources) if evidence is not None else ()
    criteria = "\n".join(f"- {item}" for item in tuple(rubric.get("criteria") or ()))
    score_bands = "\n".join(
        f"- {item['range']}: {item['description']}"
        for item in tuple(rubric.get("score_bands") or ())
        if isinstance(item, dict)
    )
    return "\n".join(
        (
            str(rubric.get("system_prompt") or "").strip(),
            "",
            f"Metric: {rubric.get('metric_name')}",
            f"Applicability: {','.join(str(item) for item in tuple(rubric.get('applies_to_statuses') or ()))}",
            f"Goal: {case.user_goal}",
            f"Expected status: {case.expected_status}",
            f"Response status: {response.status}",
            f"Answer text: {_normalize_prompt_text(response.answer_text)}",
            f"Follow-up question: {_normalize_prompt_text(response.follow_up_question)}",
            f"Required facts: {_normalize_prompt_text('; '.join(case.required_facts))}",
            f"Forbidden claims: {_normalize_prompt_text('; '.join(case.forbidden_claims))}",
            "Retrieved evidence:",
            _format_sources_for_prompt(sources),
            "",
            "Criteria:",
            criteria or "- none",
            "",
            "Score bands:",
            score_bands or "- none",
            "",
            "Return exactly one JSON object with keys:",
            '{"score": <number 0..1>, "verdict": "passed|failed", "rationale": "<short rationale>"}',
        )
    ).strip()


def _coerce_judge_result(
    *,
    adapter_id: str,
    metric_name: str,
    case: GoldenCase,
    response: CapabilityResponse | ExecutionResponse,
    judged: dict[str, object],
) -> SupplementalResult:
    if not isinstance(judged, dict):
        raise ValueError("judge result must be a JSON object")
    raw_score = judged.get("score")
    raw_verdict = judged.get("verdict")
    raw_rationale = str(judged.get("rationale") or "").strip()
    if raw_score is None:
        raise ValueError("judge result score is required")
    score = float(raw_score)
    if score < 0.0 or score > 1.0:
        raise ValueError("judge result score must be between 0 and 1")
    verdict = str(raw_verdict or "").strip() or ("passed" if score >= 0.8 else "failed")
    if verdict not in {"passed", "failed"}:
        raise ValueError("judge result verdict must be passed or failed")
    return SupplementalResult(
        adapter_id=adapter_id,
        metric_name=metric_name,
        score=score,
        verdict=verdict,
        rationale=raw_rationale or f"judged {case.case_id}",
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
        },
    )


def _build_not_applicable_result(
    *,
    adapter_id: str,
    metric_name: str,
    case: GoldenCase,
    response: CapabilityResponse | ExecutionResponse,
    rationale: str,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id=adapter_id,
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
    adapter_id: str,
    metric_name: str,
    case: GoldenCase,
    response: CapabilityResponse | ExecutionResponse,
    rationale: str,
    score: float | None,
    metadata: dict[str, object] | None = None,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id=adapter_id,
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
    return metadata


def _require_capability_response(
    execution: ExecutionResult,
) -> CapabilityResponse | ExecutionResponse:
    response = execution.response
    if not isinstance(response, (CapabilityResponse, ExecutionResponse)):
        raise TypeError("execution.response must be CapabilityResponse or ExecutionResponse")
    return response


def _parse_judge_json(text: str) -> dict[str, object]:
    stripped = text.strip()
    if not stripped:
        raise ValueError("judge response text must not be empty")
    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass
    fenced_match = _JSON_BLOCK_RE.search(stripped)
    if fenced_match is not None:
        payload = json.loads(fenced_match.group(1))
        if isinstance(payload, dict):
            return payload
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        payload = json.loads(stripped[start : end + 1])
        if isinstance(payload, dict):
            return payload
    raise ValueError("judge response did not contain a JSON object")


def _format_sources_for_prompt(sources: tuple[object, ...]) -> str:
    if not sources:
        return "- none"
    lines: list[str] = []
    for index, source in enumerate(sources[:5], start=1):
        snippet = _normalize_prompt_text(getattr(source, "snippet", ""))
        lines.append(
            f"- [{index}] doc_id={getattr(source, 'doc_id', '')} chunk_id={getattr(source, 'chunk_id', '')} snippet={snippet}"
        )
    return "\n".join(lines)


def _normalize_prompt_text(text: str) -> str:
    normalized = " ".join((text or "").split())
    return normalized or "<empty>"
