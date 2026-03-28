from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Callable

import httpx
from langchain_core.prompt_values import StringPromptValue

from campus_contracts import RagResultPayload, SpecialistResponse
from campus_evals.models import ExecutionResult, GoldenCase, SupplementalResult
from campus_evals.ragas_adapter import build_default_ragas_metric_names, build_ragas_scorer
from campus_evals.ragas_http import OpenAICompatibleResponsesLLM, get_request_pacer
from campus_evals.settings import JudgeLLMSettings, RagasSettings


JudgeFn = Callable[[str], dict[str, object]]
DEFAULT_STUDENT_HANDBOOK_JUDGE_RUBRICS_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "student_handbook_judge_rubrics.json"
)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)


class HandbookRagasAdapter:
    adapter_id = "ragas"

    def __init__(
        self,
        *,
        scorer: Callable[[object], tuple[SupplementalResult, ...]],
        metric_names: tuple[str, ...],
    ) -> None:
        self._scorer = scorer
        self._metric_names = metric_names

    def evaluate(self, case: GoldenCase, execution: ExecutionResult) -> tuple[SupplementalResult, ...]:
        response = _require_specialist_response(execution)
        if case.expected_status != "completed":
            return tuple(
                _build_not_applicable_result(
                    adapter_id=self.adapter_id,
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
                    adapter_id=self.adapter_id,
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale=f"expected completed response but got {response.status}",
                    score=0.0,
                )
                for metric_name in self._metric_names
            )
        try:
            results = tuple(self._scorer(_build_ragas_projection(case, execution)))
        except Exception as exc:
            return tuple(
                _build_failed_result(
                    adapter_id=self.adapter_id,
                    metric_name=metric_name,
                    case=case,
                    response=response,
                    rationale=f"ragas runtime error: {exc}",
                    score=None,
                    metadata={"judge_error": type(exc).__name__},
                )
                for metric_name in self._metric_names
            )
        by_metric_name = {result.metric_name: result for result in results}
        final_results: list[SupplementalResult] = []
        for metric_name in self._metric_names:
            result = by_metric_name.get(metric_name)
            if result is None:
                final_results.append(
                    _build_not_applicable_result(
                        adapter_id=self.adapter_id,
                        metric_name=metric_name,
                        case=case,
                        response=response,
                        rationale=f"ragas scorer did not return metric {metric_name}",
                    )
                )
                continue
            final_results.append(
                SupplementalResult(
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
            )
        return tuple(final_results)


class RubricJudgeAdapter:
    adapter_id = "judge"

    def __init__(
        self,
        *,
        metric_name: str,
        applicable_statuses: tuple[str, ...],
        rubric: dict[str, object],
        judge_fn: JudgeFn,
    ) -> None:
        self.metric_name = metric_name
        self._applicable_statuses = applicable_statuses
        self._rubric = rubric
        self._judge_fn = judge_fn

    def evaluate(self, case: GoldenCase, execution: ExecutionResult) -> tuple[SupplementalResult, ...]:
        response = _require_specialist_response(execution)
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
            judged = self._judge_fn(prompt)
        except Exception as exc:
            return (
                _build_failed_result(
                    adapter_id=self.adapter_id,
                    metric_name=self.metric_name,
                    case=case,
                    response=response,
                    rationale=f"judge runtime error: {exc}",
                    score=None,
                    metadata={"judge_error": type(exc).__name__},
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
) -> HandbookRagasAdapter:
    resolved_metric_names = metric_names or build_default_ragas_metric_names()
    return HandbookRagasAdapter(
        scorer=scorer or build_ragas_scorer(settings),
        metric_names=resolved_metric_names,
    )


def build_answer_rubric_adapter(
    settings: JudgeLLMSettings,
    *,
    judge_fn: JudgeFn | None = None,
    rubrics_path: str | Path | None = None,
    sync_client: httpx.Client | None = None,
) -> RubricJudgeAdapter:
    rubric = load_handbook_judge_rubrics(rubrics_path)["answer_correctness_rubric"]
    return RubricJudgeAdapter(
        metric_name="answer_correctness_rubric",
        applicable_statuses=("completed",),
        rubric=rubric,
        judge_fn=judge_fn or build_responses_json_judge(settings, sync_client=sync_client),
    )


def build_refusal_rubric_adapter(
    settings: JudgeLLMSettings,
    *,
    judge_fn: JudgeFn | None = None,
    rubrics_path: str | Path | None = None,
    sync_client: httpx.Client | None = None,
) -> RubricJudgeAdapter:
    rubric = load_handbook_judge_rubrics(rubrics_path)["refusal_quality"]
    return RubricJudgeAdapter(
        metric_name="refusal_quality",
        applicable_statuses=("no_answer", "needs_clarification"),
        rubric=rubric,
        judge_fn=judge_fn or build_responses_json_judge(settings, sync_client=sync_client),
    )


def build_default_handbook_supplemental_adapters_from_env(
    env: dict[str, str] | None = None,
    *,
    metric_names: tuple[str, ...] | None = None,
) -> tuple[object, ...]:
    return (
        build_handbook_ragas_adapter(RagasSettings.from_env(env), metric_names=metric_names),
        build_answer_rubric_adapter(JudgeLLMSettings.from_env(env)),
        build_refusal_rubric_adapter(JudgeLLMSettings.from_env(env)),
    )


def build_responses_json_judge(
    settings: JudgeLLMSettings,
    *,
    sync_client: httpx.Client | None = None,
) -> JudgeFn:
    llm = OpenAICompatibleResponsesLLM(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        timeout=settings.request_timeout_seconds,
        reasoning_effort=settings.reasoning_effort,
        text_verbosity=settings.text_verbosity,
        max_output_tokens=settings.max_output_tokens,
        request_pacer=get_request_pacer(
            base_url=settings.llm_base_url or "https://api.openai.com/v1",
            api_key=settings.llm_api_key,
            min_interval_seconds=settings.request_min_interval_seconds,
        ),
        sync_client=sync_client,
    )

    def _judge(prompt: str) -> dict[str, object]:
        result = llm.generate_text(StringPromptValue(text=prompt))
        text = result.generations[0][0].text
        return _parse_judge_json(text)

    return _judge


def _build_rubric_prompt(
    *,
    rubric: dict[str, object],
    case: GoldenCase,
    response: SpecialistResponse,
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
    response: SpecialistResponse,
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
    response: SpecialistResponse,
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
    response: SpecialistResponse,
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


def _build_ragas_projection(case: GoldenCase, execution: ExecutionResult):
    from campus_evals.ragas_adapter import build_ragas_projection

    return build_ragas_projection(case, execution)


def _require_specialist_response(execution: ExecutionResult) -> SpecialistResponse:
    response = execution.response
    if not isinstance(response, SpecialistResponse):
        raise TypeError("execution.response must be SpecialistResponse")
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
