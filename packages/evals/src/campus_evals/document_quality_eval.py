from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from campus_evals.models import reject_forbidden_workflow_trace_keys

DOCUMENT_QUALITY_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "document_quality_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class DocumentQualityCase:
    case_id: str
    required_spans: tuple[str, ...]
    required_table_headers: tuple[str, ...] = ()
    forbidden_claims: tuple[str, ...] = ()
    min_confidence: float = 0.0
    allowed_projection_targets: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DocumentQualityCaseSet:
    schema_version: int
    cases: tuple[DocumentQualityCase, ...]


@dataclass(frozen=True, slots=True)
class DocumentQualityObservation:
    case_id: str
    extracted_text: str
    table_headers: tuple[str, ...] = ()
    confidence: float = 0.0
    projection_target: str = ""
    claims: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        reject_forbidden_workflow_trace_keys(
            {
                "extracted_text": self.extracted_text,
                "table_headers": self.table_headers,
                "projection_target": self.projection_target,
                "claims": self.claims,
            },
            "document_quality_observation",
        )


@dataclass(frozen=True, slots=True)
class DocumentQualityResult:
    case_id: str
    passed: bool
    reason: str


@dataclass(frozen=True, slots=True)
class DocumentQualityReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[DocumentQualityResult, ...]


def load_document_quality_cases(path: str | Path | None = None) -> DocumentQualityCaseSet:
    payload = _load_json(Path(path) if path is not None else DOCUMENT_QUALITY_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("document quality schema_version must be 1")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("document quality cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    return DocumentQualityCaseSet(schema_version=1, cases=cases)


def evaluate_document_quality_cases(
    cases: tuple[DocumentQualityCase, ...],
    observations: dict[str, DocumentQualityObservation],
) -> DocumentQualityReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    return DocumentQualityReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def _evaluate_case(
    case: DocumentQualityCase,
    observation: DocumentQualityObservation | None,
) -> DocumentQualityResult:
    if observation is None:
        return DocumentQualityResult(case.case_id, False, "missing observation")
    normalized_text = _normalize(observation.extracted_text)
    normalized_headers = {_normalize(header) for header in observation.table_headers}
    normalized_claims = tuple(_normalize(claim) for claim in observation.claims)
    failures: list[str] = []
    for span in case.required_spans:
        if _normalize(span) not in normalized_text:
            failures.append(f"missing required span: {span}")
    for header in case.required_table_headers:
        if _normalize(header) not in normalized_headers:
            failures.append(f"missing table header: {header}")
    if observation.confidence < case.min_confidence:
        failures.append("confidence below minimum")
    if (
        case.allowed_projection_targets
        and observation.projection_target not in case.allowed_projection_targets
    ):
        failures.append("forbidden projection target")
    for forbidden_claim in case.forbidden_claims:
        if _normalize(forbidden_claim) in normalized_claims:
            failures.append(f"forbidden claim: {forbidden_claim}")
    return DocumentQualityResult(
        case.case_id,
        not failures,
        "ok" if not failures else "; ".join(failures),
    )


def _parse_case(payload: object) -> DocumentQualityCase:
    item = _mapping(payload, "case")
    return DocumentQualityCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        required_spans=_string_tuple(item.get("required_spans"), "required_spans"),
        required_table_headers=_string_tuple(
            item.get("required_table_headers") or [],
            "required_table_headers",
            allow_empty=True,
        ),
        forbidden_claims=_string_tuple(
            item.get("forbidden_claims") or [],
            "forbidden_claims",
            allow_empty=True,
        ),
        min_confidence=float(item.get("min_confidence") or 0.0),
        allowed_projection_targets=_string_tuple(
            item.get("allowed_projection_targets") or [],
            "allowed_projection_targets",
            allow_empty=True,
        ),
    )


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _string_tuple(value: object, field_name: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        raise ValueError(f"{field_name} must be a list")
    items = tuple(_required_string(item, field_name) for item in value)
    if not allow_empty and not items:
        raise ValueError(f"{field_name} must not be empty")
    return items


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _normalize(value: str) -> str:
    return "".join(str(value).split()).lower()


__all__ = [
    "DOCUMENT_QUALITY_CASES_PATH",
    "DocumentQualityCase",
    "DocumentQualityCaseSet",
    "DocumentQualityObservation",
    "DocumentQualityReport",
    "DocumentQualityResult",
    "evaluate_document_quality_cases",
    "load_document_quality_cases",
]
