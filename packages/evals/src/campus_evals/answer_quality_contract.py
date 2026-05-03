from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_evals.profile_report import (
    EvalProfileReport,
    load_json_object,
    load_observation_mapping,
    required_string,
    string_tuple,
    version_summary,
    write_profile_report,
)

ANSWER_QUALITY_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "answer_quality_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class AnswerQualityCase:
    case_id: str
    split: str
    surface: str
    required_facts: tuple[str, ...]
    forbidden_claims: tuple[str, ...]
    requires_source_url: bool
    requires_source_title: bool
    required_source_titles: tuple[str, ...] = ()
    required_source_url_fragments: tuple[str, ...] = ()
    forbidden_source_title_fragments: tuple[str, ...] = ()
    forbidden_source_url_fragments: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AnswerQualityCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[AnswerQualityCase, ...]


@dataclass(frozen=True, slots=True)
class AnswerQualityObservation:
    case_id: str
    answer_text: str
    source_urls: tuple[str, ...] = ()
    source_titles: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AnswerQualityResult:
    case_id: str
    passed: bool
    failure_class: str
    reason: str


@dataclass(frozen=True, slots=True)
class AnswerQualityReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[AnswerQualityResult, ...]


def load_answer_quality_cases(path: str | Path | None = None) -> AnswerQualityCaseSet:
    payload = load_json_object(Path(path) if path is not None else ANSWER_QUALITY_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("answer quality case schema_version must be 1")
    case_family = required_string(payload.get("case_family"), "case_family")
    if case_family != "answer_quality_contract.v1":
        raise ValueError("unsupported answer quality case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("answer quality cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return AnswerQualityCaseSet(schema_version=1, case_family=case_family, cases=cases)


def evaluate_answer_quality_cases(
    cases: tuple[AnswerQualityCase, ...],
    observations: Mapping[str, AnswerQualityObservation],
) -> AnswerQualityReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    return AnswerQualityReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def run_answer_quality_contract_profile(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileReport:
    case_set = load_answer_quality_cases(cases_path)
    observations = _load_observations(observations_path)
    report = evaluate_answer_quality_cases(case_set.cases, observations)
    return write_profile_report(
        output_dir=output_dir,
        profile_id="answer_quality_contract",
        case_family=case_set.case_family,
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=version_summary(
            case_set_version=case_set.case_family,
            git_head_resolver=git_head_resolver,
        ),
    )


def _evaluate_case(
    case: AnswerQualityCase,
    observation: AnswerQualityObservation | None,
) -> AnswerQualityResult:
    if observation is None:
        return AnswerQualityResult(
            case.case_id, False, "missing_observation", "missing observation"
        )
    answer_text = observation.answer_text
    for forbidden_claim in case.forbidden_claims:
        if forbidden_claim and forbidden_claim in answer_text:
            return AnswerQualityResult(
                case.case_id,
                False,
                "forbidden_claim_present",
                f"forbidden_claim={forbidden_claim}",
            )
    for required_fact in case.required_facts:
        if required_fact and required_fact not in answer_text:
            return AnswerQualityResult(
                case.case_id,
                False,
                "required_fact_missing",
                f"required_fact={required_fact}",
            )
    if case.requires_source_url and not observation.source_urls:
        return AnswerQualityResult(case.case_id, False, "source_url_missing", "source URL missing")
    if case.requires_source_title and not observation.source_titles:
        return AnswerQualityResult(
            case.case_id,
            False,
            "source_title_missing",
            "source title missing",
        )
    for forbidden_fragment in case.forbidden_source_title_fragments:
        if _contains_fragment(observation.source_titles, forbidden_fragment):
            return AnswerQualityResult(
                case.case_id,
                False,
                "forbidden_source_title_present",
                f"forbidden_source_title_fragment={forbidden_fragment}",
            )
    for forbidden_fragment in case.forbidden_source_url_fragments:
        if _contains_fragment(observation.source_urls, forbidden_fragment):
            return AnswerQualityResult(
                case.case_id,
                False,
                "forbidden_source_url_present",
                f"forbidden_source_url_fragment={forbidden_fragment}",
            )
    for required_title in case.required_source_titles:
        if not _contains_fragment(observation.source_titles, required_title):
            return AnswerQualityResult(
                case.case_id,
                False,
                "required_source_title_missing",
                f"required_source_title={required_title}",
            )
    for required_fragment in case.required_source_url_fragments:
        if not _contains_fragment(observation.source_urls, required_fragment):
            return AnswerQualityResult(
                case.case_id,
                False,
                "required_source_url_missing",
                f"required_source_url_fragment={required_fragment}",
            )
    return AnswerQualityResult(case.case_id, True, "", "ok")


def _load_observations(path: Path | None) -> dict[str, AnswerQualityObservation]:
    return {
        case_id: AnswerQualityObservation(
            case_id=case_id,
            answer_text=str(item.get("answer_text") or ""),
            source_urls=string_tuple(item.get("source_urls")),
            source_titles=string_tuple(item.get("source_titles")),
        )
        for case_id, item in load_observation_mapping(path).items()
    }


def _parse_case(payload: object) -> AnswerQualityCase:
    if not isinstance(payload, dict):
        raise ValueError("answer quality case must be an object")
    return AnswerQualityCase(
        case_id=required_string(payload.get("case_id"), "case_id"),
        split=required_string(payload.get("split"), "split"),
        surface=required_string(payload.get("surface"), "surface"),
        required_facts=string_tuple(payload.get("required_facts")),
        forbidden_claims=string_tuple(payload.get("forbidden_claims")),
        requires_source_url=bool(payload.get("requires_source_url")),
        requires_source_title=bool(payload.get("requires_source_title")),
        required_source_titles=string_tuple(payload.get("required_source_titles")),
        required_source_url_fragments=string_tuple(
            payload.get("required_source_url_fragments")
        ),
        forbidden_source_title_fragments=string_tuple(
            payload.get("forbidden_source_title_fragments")
        ),
        forbidden_source_url_fragments=string_tuple(
            payload.get("forbidden_source_url_fragments")
        ),
    )


def _reject_duplicate_case_ids(case_ids: object) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate answer quality case_id: {case_id}")
        seen.add(case_id)


def _contains_fragment(values: tuple[str, ...], fragment: str) -> bool:
    normalized_fragment = fragment.strip()
    return bool(normalized_fragment) and any(normalized_fragment in value for value in values)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run answer quality contract profile.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept = subparsers.add_parser("accept")
    accept.add_argument("--output-dir", required=True)
    accept.add_argument("--reruns", type=int, default=1)
    accept.add_argument("--cases-path")
    accept.add_argument("--observations-path")
    accept.add_argument("--collect-runtime", action="store_true")
    accept.add_argument("--artifact-path", action="append", default=[])
    accept.add_argument("--verbose", action="store_true")
    accept.add_argument("--log-jsonl")
    accept.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("answer quality contract gate is deterministic and requires reruns=1")
    if args.collect_runtime:
        raise ValueError("answer quality runtime collection is not implemented yet")
    report = run_answer_quality_contract_profile(
        output_dir=Path(args.output_dir),
        cases_path=Path(args.cases_path) if args.cases_path else None,
        observations_path=Path(args.observations_path) if args.observations_path else None,
    )
    if args.json:
        print(report.output_path.read_text(encoding="utf-8").strip())
    elif args.verbose:
        print(f"answer-quality-contract: {'PASS' if report.passed else 'FAIL'}")
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
