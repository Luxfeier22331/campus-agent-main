from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path

import httpx
from campus_shared import load_repo_env

_DEFAULT_METRIC_DOMAIN_MAP = {
    "ragas.faithfulness": "grounding",
    "ragas.answer_relevancy": "grounding",
    "judge.answer_correctness_rubric": "grounding",
    "ragas.context_precision": "citation",
    "ragas.context_recall": "citation",
    "judge.refusal_quality": "policy",
    "deterministic.out_of_scope_accuracy": "policy",
    "deterministic.policy_refusal_accuracy": "policy",
    "deterministic.restricted_access_denied_accuracy": "policy",
    "deterministic.freshness_fail_close_accuracy": "policy",
    "deterministic.unsupported_abstention_accuracy": "policy",
    "deterministic.false_refusal_rate": "policy",
    "deterministic.unsafe_false_allow_rate": "policy",
}
_DEFAULT_METRIC_PASS_SCORE_MAP = {
    "ragas.faithfulness": 0.85,
    "ragas.answer_relevancy": 0.75,
    "ragas.context_precision": 0.85,
    "ragas.context_recall": 0.85,
    "judge.answer_correctness_rubric": 0.8,
    "judge.refusal_quality": 0.8,
}
_DEFAULT_METRIC_PRIORITY = {
    "ragas.faithfulness": 10,
    "judge.answer_correctness_rubric": 20,
    "ragas.context_precision": 10,
    "ragas.context_recall": 20,
    "judge.refusal_quality": 10,
    "deterministic.out_of_scope_accuracy": 10,
    "deterministic.policy_refusal_accuracy": 10,
    "deterministic.restricted_access_denied_accuracy": 10,
    "deterministic.freshness_fail_close_accuracy": 10,
    "deterministic.unsupported_abstention_accuracy": 10,
    "deterministic.false_refusal_rate": 10,
    "deterministic.unsafe_false_allow_rate": 5,
}
_ALLOWED_GRADE_DOMAINS = frozenset({"grounding", "citation", "policy"})
_PUBLISHABLE_VERDICT_MAP = {
    "passed": "pass",
    "failed": "fail",
}
_PUBLISHABLE_VERDICT_SEVERITY = {
    "pass": 0,
    "needs_review": 1,
    "fail": 2,
}


@dataclass(frozen=True, slots=True)
class OperatorObservabilityClientSettings:
    app_api_base_url: str
    internal_shared_secret: str
    timeout_seconds: float = 10.0

    def __post_init__(self) -> None:
        if not self.app_api_base_url.strip():
            raise ValueError("app_api_base_url is required")
        if not self.internal_shared_secret.strip():
            raise ValueError("internal_shared_secret is required")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
    ) -> "OperatorObservabilityClientSettings":
        source = env if env is not None else os.environ
        app_api_base_url = str(source.get("APP_API_BASE_URL") or "").strip()
        internal_shared_secret = str(source.get("APP_API_INTERNAL_SHARED_SECRET") or "").strip()
        timeout_raw = str(source.get("OPERATOR_OBSERVABILITY_HTTP_TIMEOUT_SECONDS") or "").strip()
        timeout_seconds = float(timeout_raw) if timeout_raw else 10.0
        return cls(
            app_api_base_url=app_api_base_url,
            internal_shared_secret=internal_shared_secret,
            timeout_seconds=timeout_seconds,
        )


@dataclass(frozen=True, slots=True)
class OperatorRequestCorrelation:
    case_id: str
    request_id: str
    trace_id: str
    sampled_at: str
    trace_link: str | None = None
    issue_link: str | None = None
    issue_fingerprint: str | None = None


@dataclass(frozen=True, slots=True)
class OperatorQualityGrade:
    request_id: str
    trace_id: str
    grade_source: str
    grade_domain: str
    verdict: str
    score: float | None
    grader_version: str
    sampled_at: str
    rationale_summary: str | None = None


@dataclass(frozen=True, slots=True)
class OperatorTraceBacklink:
    request_id: str
    trace_id: str
    trace_link: str | None = None
    issue_link: str | None = None
    issue_fingerprint: str | None = None


@dataclass(frozen=True, slots=True)
class OperatorSkippedPublishItem:
    case_id: str
    metric_key: str
    reason: str


@dataclass(frozen=True, slots=True)
class OperatorPublishBatch:
    grades: tuple[OperatorQualityGrade, ...]
    backlinks: tuple[OperatorTraceBacklink, ...]
    skipped: tuple[OperatorSkippedPublishItem, ...]


@dataclass(frozen=True, slots=True)
class _DomainGradeCandidate:
    metric_key: str
    grade_domain: str
    verdict: str
    score: float | None
    rationale_summary: str | None
    priority: int


class OperatorObservabilityClientError(RuntimeError):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: object = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.status_code = status_code
        self.code = code
        self.details = details


class OperatorObservabilityClient:
    def __init__(
        self,
        *,
        settings: OperatorObservabilityClientSettings,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings
        self._client = client

    def ingest_quality_grades(self, grades: tuple[OperatorQualityGrade, ...]) -> int:
        response = self._request(
            "/api/internal/operator/quality/grades",
            {
                "grades": [
                    {
                        "requestId": item.request_id,
                        "traceId": item.trace_id,
                        "gradeSource": item.grade_source,
                        "gradeDomain": item.grade_domain,
                        "verdict": item.verdict,
                        "score": item.score,
                        "graderVersion": item.grader_version,
                        "sampledAt": item.sampled_at,
                        "rationaleSummary": item.rationale_summary,
                    }
                    for item in grades
                ]
            },
        )
        payload = _decode_json(response)
        return int(payload.get("accepted") or 0)

    def ingest_trace_backlinks(self, backlinks: tuple[OperatorTraceBacklink, ...]) -> int:
        response = self._request(
            "/api/internal/operator/trace-backlinks",
            {
                "backlinks": [
                    {
                        "requestId": item.request_id,
                        "traceId": item.trace_id,
                        "traceLink": item.trace_link,
                        "issueLink": item.issue_link,
                        "issueFingerprint": item.issue_fingerprint,
                    }
                    for item in backlinks
                ]
            },
        )
        payload = _decode_json(response)
        return int(payload.get("accepted") or 0)

    def _request(self, path: str, body: dict[str, object]) -> httpx.Response:
        if self._client is not None:
            response = self._client.post(
                path,
                json=body,
                headers={"x-app-internal-auth": self.settings.internal_shared_secret},
            )
        else:
            with httpx.Client(
                base_url=self.settings.app_api_base_url.rstrip("/"),
                timeout=self.settings.timeout_seconds,
            ) as client:
                response = client.post(
                    path,
                    json=body,
                    headers={"x-app-internal-auth": self.settings.internal_shared_secret},
                )
        if response.status_code < 400:
            return response
        payload = _decode_json(response)
        error_payload = dict(payload.get("error") or {})
        raise OperatorObservabilityClientError(
            status_code=response.status_code,
            code=str(error_payload.get("code") or "operator_observability_request_failed"),
            message=str(error_payload.get("message") or response.text or "request failed"),
            details=error_payload.get("details"),
        )


def load_request_correlation_manifest(
    path: str | Path,
) -> dict[str, OperatorRequestCorrelation]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    cases = payload.get("cases")
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("request correlation manifest schema_version must be 1")
    if not isinstance(cases, list):
        raise ValueError("request correlation manifest cases must be a list")

    correlations: dict[str, OperatorRequestCorrelation] = {}
    for raw_item in cases:
        item = dict(raw_item or {})
        correlation = OperatorRequestCorrelation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            request_id=_required_string(item.get("request_id"), "request_id"),
            trace_id=_required_string(item.get("trace_id"), "trace_id"),
            sampled_at=_required_string(item.get("sampled_at"), "sampled_at"),
            trace_link=_optional_string(item.get("trace_link")),
            issue_link=_optional_string(item.get("issue_link")),
            issue_fingerprint=_optional_string(item.get("issue_fingerprint")),
        )
        correlations[correlation.case_id] = correlation
    return correlations


def build_case_results_publish_batch(
    *,
    case_results_payload: dict[str, object],
    correlations: dict[str, OperatorRequestCorrelation],
    grade_source: str,
    grader_version: str,
    metric_domain_overrides: dict[str, str] | None = None,
) -> OperatorPublishBatch:
    domain_map = {
        **_DEFAULT_METRIC_DOMAIN_MAP,
        **{
            key: value
            for key, value in dict(metric_domain_overrides or {}).items()
            if value in _ALLOWED_GRADE_DOMAINS
        },
    }
    grades: list[OperatorQualityGrade] = []
    backlinks: list[OperatorTraceBacklink] = []
    skipped: list[OperatorSkippedPublishItem] = []
    backlink_keys: set[tuple[str, str]] = set()
    missing_case_ids: set[str] = set()
    inline_correlations = _extract_inline_request_correlations(case_results_payload)

    for raw_result in case_results_payload.get("results") or ():
        result = dict(raw_result or {})
        case_id = _required_string(result.get("case_id"), "results[].case_id")
        correlation = correlations.get(case_id) or inline_correlations.get(case_id)
        supplemental_results = result.get("supplemental_results") or ()
        metric_results = dict(result.get("metric_results") or {})
        domain_candidates: dict[str, list[_DomainGradeCandidate]] = {}

        for raw_supplemental in supplemental_results:
            supplemental = dict(raw_supplemental or {})
            metric_key = _build_metric_key(supplemental)
            mapped_verdict = _map_publishable_verdict(metric_key, supplemental)
            if mapped_verdict is None:
                skipped.append(
                    OperatorSkippedPublishItem(
                        case_id=case_id,
                        metric_key=metric_key,
                        reason="verdict_not_publishable",
                    )
                )
                continue

            grade_domain = domain_map.get(metric_key)
            if grade_domain is None:
                skipped.append(
                    OperatorSkippedPublishItem(
                        case_id=case_id,
                        metric_key=metric_key,
                        reason="unsupported_metric_domain",
                    )
                )
                continue

            if correlation is None:
                missing_case_ids.add(case_id)
                continue

            domain_candidates.setdefault(grade_domain, []).append(
                _DomainGradeCandidate(
                    metric_key=metric_key,
                    grade_domain=grade_domain,
                    verdict=mapped_verdict,
                    score=_optional_float(supplemental.get("score")),
                    rationale_summary=_optional_string(supplemental.get("rationale")),
                    priority=_DEFAULT_METRIC_PRIORITY.get(metric_key, 100),
                )
            )

        for metric_name, raw_metric in metric_results.items():
            metric = dict(raw_metric or {})
            metric_key = f"deterministic.{str(metric_name)}"
            mapped_verdict = _map_deterministic_publishable_verdict(metric)
            if mapped_verdict is None:
                skipped.append(
                    OperatorSkippedPublishItem(
                        case_id=case_id,
                        metric_key=metric_key,
                        reason="verdict_not_publishable",
                    )
                )
                continue

            grade_domain = domain_map.get(metric_key)
            if grade_domain is None:
                skipped.append(
                    OperatorSkippedPublishItem(
                        case_id=case_id,
                        metric_key=metric_key,
                        reason="unsupported_metric_domain",
                    )
                )
                continue

            if correlation is None:
                missing_case_ids.add(case_id)
                continue

            domain_candidates.setdefault(grade_domain, []).append(
                _DomainGradeCandidate(
                    metric_key=metric_key,
                    grade_domain=grade_domain,
                    verdict=mapped_verdict,
                    score=None,
                    rationale_summary=_optional_string(metric.get("reason")),
                    priority=_DEFAULT_METRIC_PRIORITY.get(metric_key, 100),
                )
            )

        if correlation is not None:
            for candidates in domain_candidates.values():
                grades.append(
                    _build_domain_grade(
                        candidates=tuple(candidates),
                        correlation=correlation,
                        grade_source=grade_source,
                        grader_version=grader_version,
                    )
                )

        if correlation is None:
            continue
        backlink_key = (correlation.request_id, correlation.trace_id)
        if backlink_key in backlink_keys:
            continue
        if not any(
            value is not None
            for value in (
                correlation.trace_link,
                correlation.issue_link,
                correlation.issue_fingerprint,
            )
        ):
            continue
        backlinks.append(
            OperatorTraceBacklink(
                request_id=correlation.request_id,
                trace_id=correlation.trace_id,
                trace_link=correlation.trace_link,
                issue_link=correlation.issue_link,
                issue_fingerprint=correlation.issue_fingerprint,
            )
        )
        backlink_keys.add(backlink_key)

    if missing_case_ids:
        joined = ", ".join(sorted(missing_case_ids))
        raise ValueError(f"missing request correlations for case ids: {joined}")

    return OperatorPublishBatch(
        grades=tuple(grades),
        backlinks=tuple(backlinks),
        skipped=tuple(skipped),
    )


def _extract_inline_request_correlations(
    case_results_payload: dict[str, object],
) -> dict[str, OperatorRequestCorrelation]:
    correlations: dict[str, OperatorRequestCorrelation] = {}
    for raw_result in case_results_payload.get("results") or ():
        result = dict(raw_result or {})
        raw_correlation = result.get("request_correlation")
        if not isinstance(raw_correlation, dict):
            continue
        case_id = _required_string(result.get("case_id"), "results[].case_id")
        correlation = OperatorRequestCorrelation(
            case_id=case_id,
            request_id=_required_string(
                raw_correlation.get("request_id"), "results[].request_correlation.request_id"
            ),
            trace_id=_required_string(
                raw_correlation.get("trace_id"), "results[].request_correlation.trace_id"
            ),
            sampled_at=_required_string(
                raw_correlation.get("sampled_at"), "results[].request_correlation.sampled_at"
            ),
            trace_link=_optional_string(raw_correlation.get("trace_link")),
            issue_link=_optional_string(raw_correlation.get("issue_link")),
            issue_fingerprint=_optional_string(raw_correlation.get("issue_fingerprint")),
        )
        correlations[case_id] = correlation
    return correlations


def build_publish_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish operator observability grades/backlinks to app-api from eval artifacts.",
    )
    parser.add_argument(
        "--case-results", required=True, help="Path to run-XX-case-results.json artifact."
    )
    parser.add_argument(
        "--request-correlations",
        required=False,
        help="Optional explicit case_id -> request_id/trace_id correlation manifest. If omitted, use inline request_correlation from case-results.",
    )
    parser.add_argument(
        "--grade-source", required=True, help="Stable producer/source id for app-api grade upserts."
    )
    parser.add_argument(
        "--grader-version", required=True, help="Grader/runtime version label for published grades."
    )
    parser.add_argument(
        "--metric-domain-override",
        action="append",
        default=[],
        help="Optional metric-to-domain override in the form adapter.metric=grounding|citation|policy.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the publish batch but do not POST to app-api.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render publish summary as text or JSON.",
    )
    return parser


def publish_case_results_artifact(
    *,
    case_results_path: str | Path,
    request_correlations_path: str | Path | None,
    grade_source: str,
    grader_version: str,
    metric_domain_overrides: dict[str, str] | None = None,
    settings: OperatorObservabilityClientSettings | None = None,
    dry_run: bool = False,
) -> dict[str, object]:
    case_results_payload = json.loads(Path(case_results_path).read_text(encoding="utf-8"))
    correlations = (
        load_request_correlation_manifest(request_correlations_path)
        if request_correlations_path is not None
        else {}
    )
    batch = build_case_results_publish_batch(
        case_results_payload=case_results_payload,
        correlations=correlations,
        grade_source=grade_source,
        grader_version=grader_version,
        metric_domain_overrides=metric_domain_overrides,
    )

    accepted_grades = 0
    accepted_backlinks = 0
    if not dry_run:
        resolved_settings = settings or OperatorObservabilityClientSettings.from_env()
        client = OperatorObservabilityClient(settings=resolved_settings)
        if batch.grades:
            accepted_grades = client.ingest_quality_grades(batch.grades)
        if batch.backlinks:
            accepted_backlinks = client.ingest_trace_backlinks(batch.backlinks)

    return {
        "case_results_path": str(case_results_path),
        "request_correlations_path": (
            str(request_correlations_path) if request_correlations_path is not None else None
        ),
        "grade_source": grade_source,
        "grader_version": grader_version,
        "dry_run": dry_run,
        "grade_count": len(batch.grades),
        "backlink_count": len(batch.backlinks),
        "accepted_grades": accepted_grades,
        "accepted_backlinks": accepted_backlinks,
        "skipped": [
            {
                "case_id": item.case_id,
                "metric_key": item.metric_key,
                "reason": item.reason,
            }
            for item in batch.skipped
        ],
    }


def render_publish_summary_text(summary: dict[str, object]) -> str:
    lines = [
        "Operator Observability Publish Summary",
        f"case_results_path: {summary['case_results_path']}",
        f"request_correlations_path: {summary['request_correlations_path']}",
        f"dry_run: {summary['dry_run']}",
        f"grade_count: {summary['grade_count']}",
        f"backlink_count: {summary['backlink_count']}",
        f"accepted_grades: {summary['accepted_grades']}",
        f"accepted_backlinks: {summary['accepted_backlinks']}",
    ]
    skipped = tuple(summary.get("skipped") or ())
    if skipped:
        lines.append("skipped:")
        for item in skipped:
            entry = dict(item or {})
            lines.append(
                f"- {entry.get('case_id')} {entry.get('metric_key')} reason={entry.get('reason')}"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    args = build_publish_parser().parse_args(argv)
    summary = publish_case_results_artifact(
        case_results_path=args.case_results,
        request_correlations_path=args.request_correlations,
        grade_source=args.grade_source,
        grader_version=args.grader_version,
        metric_domain_overrides=_parse_metric_domain_overrides(args.metric_domain_override),
        dry_run=bool(args.dry_run),
    )
    if args.format == "json":
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(render_publish_summary_text(summary))
    return 0


def _build_metric_key(payload: dict[str, object]) -> str:
    adapter_id = _required_string(payload.get("adapter_id"), "supplemental_results[].adapter_id")
    metric_name = _required_string(payload.get("metric_name"), "supplemental_results[].metric_name")
    return f"{adapter_id}.{metric_name}"


def _build_domain_grade(
    *,
    candidates: tuple[_DomainGradeCandidate, ...],
    correlation: OperatorRequestCorrelation,
    grade_source: str,
    grader_version: str,
) -> OperatorQualityGrade:
    representative = _select_representative_candidate(candidates)
    return OperatorQualityGrade(
        request_id=correlation.request_id,
        trace_id=correlation.trace_id,
        grade_source=grade_source,
        grade_domain=representative.grade_domain,
        verdict=representative.verdict,
        score=representative.score,
        grader_version=grader_version,
        sampled_at=correlation.sampled_at,
        rationale_summary=representative.rationale_summary,
    )


def _select_representative_candidate(
    candidates: tuple[_DomainGradeCandidate, ...],
) -> _DomainGradeCandidate:
    if not candidates:
        raise ValueError("domain grade candidates must not be empty")
    return sorted(
        candidates,
        key=lambda item: (
            -_PUBLISHABLE_VERDICT_SEVERITY[item.verdict],
            item.score is None,
            item.score if item.score is not None else float("inf"),
            item.priority,
            item.metric_key,
        ),
    )[0]


def _map_publishable_verdict(
    metric_key: str,
    payload: dict[str, object],
) -> str | None:
    normalized = _optional_string(payload.get("verdict"))
    if normalized is not None:
        return _PUBLISHABLE_VERDICT_MAP.get(normalized)
    threshold = _DEFAULT_METRIC_PASS_SCORE_MAP.get(metric_key)
    score = _optional_float(payload.get("score"))
    if threshold is None or score is None:
        return None
    return "pass" if score >= threshold else "fail"


def _map_deterministic_publishable_verdict(payload: dict[str, object]) -> str | None:
    passed = payload.get("passed")
    if isinstance(passed, bool):
        return "pass" if passed else "fail"
    return None


def _required_string(value: object, field: str) -> str:
    normalized = _optional_string(value)
    if normalized is None:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _optional_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _decode_json(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return dict(payload or {})


def _parse_metric_domain_overrides(items: list[str]) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for item in items:
        normalized = str(item or "").strip()
        if not normalized:
            continue
        if "=" not in normalized:
            raise ValueError("metric domain override must be adapter.metric=domain")
        metric_key, domain = normalized.split("=", 1)
        metric_key = metric_key.strip()
        domain = domain.strip()
        if not metric_key:
            raise ValueError("metric domain override metric key must not be empty")
        if domain not in _ALLOWED_GRADE_DOMAINS:
            raise ValueError("metric domain override domain must be grounding, citation, or policy")
        overrides[metric_key] = domain
    return overrides
