from __future__ import annotations

import argparse
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from campus_evals.profile_report import (
    EvalProfileReport,
    load_json_object,
    load_observation_mapping,
    measured_runtime_metrics,
    required_string,
    string_tuple,
    version_summary,
    write_profile_report,
)

HINDSIGHT_MEMORY_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "hindsight_memory_product_path_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class HindsightMemoryCase:
    case_id: str
    split: str
    assertion_kind: str
    required_schema_version: str
    required_status: str
    required_tokens: tuple[str, ...]
    forbidden_tokens: tuple[str, ...]
    min_selected_memory_count: int


@dataclass(frozen=True, slots=True)
class HindsightMemoryCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[HindsightMemoryCase, ...]


@dataclass(frozen=True, slots=True)
class HindsightMemoryObservation:
    case_id: str
    status: str
    selected_memory_count: int = 0
    observed_tokens: tuple[str, ...] = ()
    forbidden_tokens: tuple[str, ...] = ()
    schema_version: str = ""
    runtime_path: str = ""


@dataclass(frozen=True, slots=True)
class HindsightMemoryResult:
    case_id: str
    passed: bool
    failure_class: str
    reason: str


@dataclass(frozen=True, slots=True)
class HindsightMemoryReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[HindsightMemoryResult, ...]


@dataclass(frozen=True, slots=True)
class HindsightMemoryRuntimeSettings:
    execution_control_base_url: str
    worker_shared_secret: str
    tenant_id: str = "eval"
    user_id: str = "eval-hindsight-memory-user"
    timeout_seconds: float = 15.0

    @classmethod
    def from_env(cls, source: Mapping[str, str] | None = None) -> HindsightMemoryRuntimeSettings:
        env = source if source is not None else os.environ
        timeout_raw = str(env.get("HINDSIGHT_MEMORY_EVAL_HTTP_TIMEOUT_SECONDS") or "").strip()
        timeout_seconds = float(timeout_raw) if timeout_raw else 15.0
        return cls(
            execution_control_base_url=str(env.get("EXECUTION_CONTROL_BASE_URL") or "").strip(),
            worker_shared_secret=str(
                env.get("API_WORKER_SHARED_SECRET")
                or env.get("EXECUTION_CONTROL_WORKER_SHARED_SECRET")
                or ""
            ).strip(),
            tenant_id=str(env.get("HINDSIGHT_MEMORY_EVAL_TENANT_ID") or "eval").strip() or "eval",
            user_id=str(
                env.get("HINDSIGHT_MEMORY_EVAL_USER_ID") or "eval-hindsight-memory-user"
            ).strip()
            or "eval-hindsight-memory-user",
            timeout_seconds=timeout_seconds,
        )

    def __post_init__(self) -> None:
        if not self.execution_control_base_url.strip():
            raise ValueError(
                "EXECUTION_CONTROL_BASE_URL is required for Hindsight memory runtime eval"
            )
        if not self.worker_shared_secret.strip():
            raise ValueError(
                "API_WORKER_SHARED_SECRET is required for Hindsight memory runtime eval"
            )
        if self.timeout_seconds <= 0:
            raise ValueError("HINDSIGHT_MEMORY_EVAL_HTTP_TIMEOUT_SECONDS must be greater than zero")


def load_hindsight_memory_cases(path: str | Path | None = None) -> HindsightMemoryCaseSet:
    payload = load_json_object(Path(path) if path is not None else HINDSIGHT_MEMORY_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("hindsight memory case schema_version must be 1")
    case_family = required_string(payload.get("case_family"), "case_family")
    if case_family != "hindsight_memory_product_path.v1":
        raise ValueError("unsupported hindsight memory case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("hindsight memory cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return HindsightMemoryCaseSet(schema_version=1, case_family=case_family, cases=cases)


def evaluate_hindsight_memory_cases(
    cases: tuple[HindsightMemoryCase, ...],
    observations: Mapping[str, HindsightMemoryObservation],
) -> HindsightMemoryReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    return HindsightMemoryReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def run_hindsight_memory_product_path_profile(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileReport:
    case_set = load_hindsight_memory_cases(cases_path)
    runtime_metrics = None
    if collect_runtime:
        started_at = datetime.now(UTC)
        monotonic_started = time.monotonic()
        observations = collect_hindsight_memory_runtime_observations(case_set)
        runtime_metrics = measured_runtime_metrics(
            profile_id="hindsight_memory_product_path",
            started_at=started_at,
            monotonic_started=monotonic_started,
            provider_calls=0,
        )
    else:
        observations = _load_observations(observations_path)
    report = evaluate_hindsight_memory_cases(case_set.cases, observations)
    return write_profile_report(
        output_dir=output_dir,
        profile_id="hindsight_memory_product_path",
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
        runtime_metrics=runtime_metrics,
    )


def collect_hindsight_memory_runtime_observations(
    case_set: HindsightMemoryCaseSet,
    *,
    settings: HindsightMemoryRuntimeSettings | None = None,
) -> dict[str, HindsightMemoryObservation]:
    resolved = settings or HindsightMemoryRuntimeSettings.from_env()
    headers = {"x-worker-origin-auth": resolved.worker_shared_secret}
    base_url = resolved.execution_control_base_url.rstrip("/")
    now = datetime.now(UTC).isoformat()
    memory_id = f"eval-hindsight-memory-{int(time.time())}"
    run_id = f"eval-hindsight-memory-run-{int(time.time())}"
    thread_id = f"eval-hindsight-memory-thread-{int(time.time())}"
    observations: dict[str, HindsightMemoryObservation] = {}
    with httpx.Client(base_url=base_url, timeout=resolved.timeout_seconds) as client:
        append = _post_json(
            client,
            "/internal/memory/personal/turns:append",
            {
                "assistant_message": "可以，我会优先结合丰台校区培养方案回答。",
                "ignore_assistant_for_graph": True,
                "run_id": run_id,
                "tenant_id": resolved.tenant_id,
                "thread_id": thread_id,
                "user_id": resolved.user_id,
                "user_message": "我主要关注丰台校区培养方案",
            },
            headers,
        )
        observations["hindsight-memory-append-completed-turn"] = _observation_from_payload(
            "hindsight-memory-append-completed-turn",
            "append_completed_turn",
            append,
        )
        recall = _post_json(
            client,
            "/internal/memory/personal/graph:recall",
            {
                "requested_capability": "knowledge",
                "run_id": run_id + "-recall",
                "tenant_id": resolved.tenant_id,
                "thread_id": thread_id + "-recall",
                "user_goal": "丰台校区培养方案怎么查？",
                "user_id": resolved.user_id,
            },
            headers,
        )
        observations["hindsight-memory-cross-thread-recall"] = _recall_observation_from_payload(
            "hindsight-memory-cross-thread-recall",
            "cross_thread_recall",
            recall,
        )
        isolation = _post_json(
            client,
            "/internal/memory/personal/graph:recall",
            {
                "requested_capability": "knowledge",
                "run_id": run_id + "-isolation",
                "tenant_id": resolved.tenant_id,
                "thread_id": thread_id + "-isolation",
                "user_goal": "丰台校区培养方案怎么查？",
                "user_id": "other-hindsight-memory-user",
            },
            headers,
        )
        observations["hindsight-memory-user-isolation"] = _recall_observation_from_payload(
            "hindsight-memory-user-isolation",
            "user_isolation",
            isolation,
        )
        upsert_payload = {
            "canonical_subject": "丰台校区培养方案偏好",
            "compact_text": "用户关注丰台校区培养方案。",
            "memory_id": memory_id,
            "tenant_id": resolved.tenant_id,
            "updated_at": now,
            "user_id": resolved.user_id,
        }
        upsert = _post_json(
            client, "/internal/memory/personal/items:upsert", upsert_payload, headers
        )
        episode_uuid = required_string(upsert.get("episode_uuid"), "episode_uuid")
        observations["hindsight-memory-explicit-profile-upsert"] = _observation_from_payload(
            "hindsight-memory-explicit-profile-upsert",
            "explicit_profile_upsert",
            upsert,
        )
        disable = _post_json(
            client,
            "/internal/memory/personal/items:disable",
            {
                "episode_uuid": episode_uuid,
                "memory_id": memory_id,
                "tenant_id": resolved.tenant_id,
                "updated_at": now,
                "user_id": resolved.user_id,
            },
            headers,
        )
        observations["hindsight-memory-explicit-profile-disable"] = _observation_from_payload(
            "hindsight-memory-explicit-profile-disable",
            "explicit_profile_disable",
            disable,
        )
        owner_disable = _post_json(
            client,
            "/internal/memory/personal/owner:disable",
            {
                "tenant_id": resolved.tenant_id,
                "updated_at": now,
                "user_id": resolved.user_id,
            },
            headers,
        )
        observations["hindsight-memory-owner-disable"] = _observation_from_payload(
            "hindsight-memory-owner-disable",
            "owner_disable",
            owner_disable,
        )
    missing = sorted(case.case_id for case in case_set.cases if case.case_id not in observations)
    if missing:
        raise RuntimeError(f"Hindsight memory runtime collector missed cases: {', '.join(missing)}")
    return observations


def _post_json(
    client: httpx.Client,
    path: str,
    payload: Mapping[str, object],
    headers: Mapping[str, str],
) -> dict[str, object]:
    response = client.post(path, json=dict(payload), headers=dict(headers))
    if response.status_code >= 400:
        raise RuntimeError(f"{path} returned HTTP {response.status_code}: {response.text}")
    value = response.json()
    if not isinstance(value, dict):
        raise ValueError(f"{path} response must be a JSON object")
    return value


def _observation_from_payload(
    case_id: str,
    runtime_path: str,
    payload: Mapping[str, object],
) -> HindsightMemoryObservation:
    return HindsightMemoryObservation(
        case_id=case_id,
        status=str(payload.get("status") or ""),
        observed_tokens=tuple(sorted(str(key) for key in payload if str(key).strip())),
        schema_version=str(payload.get("schema_version") or ""),
        runtime_path=runtime_path,
    )


def _recall_observation_from_payload(
    case_id: str,
    runtime_path: str,
    payload: Mapping[str, object],
) -> HindsightMemoryObservation:
    observed_tokens = set(str(key) for key in payload if str(key).strip())
    provider = str(payload.get("provider") or "").strip()
    if provider:
        observed_tokens.add(provider)
    retrieval_mode = str(payload.get("retrieval_mode") or "").strip()
    if retrieval_mode:
        observed_tokens.add(retrieval_mode)
    context_block = str(payload.get("context_block") or "")
    if "丰台校区" in context_block:
        observed_tokens.add("丰台校区")
    if "培养方案" in context_block:
        observed_tokens.add("培养方案")
    if "other-user-private-memory" in context_block:
        observed_tokens.add("other-user-private-memory")
    for item in _memory_context_items(payload.get("memory_context_items")):
        compact_text = str(item.get("compact_text") or "")
        if "丰台校区" in compact_text:
            observed_tokens.add("丰台校区")
        if "培养方案" in compact_text:
            observed_tokens.add("培养方案")
        if "other-user-private-memory" in compact_text:
            observed_tokens.add("other-user-private-memory")
    return HindsightMemoryObservation(
        case_id=case_id,
        status=str(payload.get("status") or ""),
        selected_memory_count=int(payload.get("selected_memory_count") or 0),
        observed_tokens=tuple(sorted(observed_tokens)),
        schema_version=str(payload.get("schema_version") or ""),
        runtime_path=runtime_path,
    )


def _memory_context_items(value: object) -> tuple[Mapping[str, object], ...]:
    if not isinstance(value, list):
        return ()
    items: list[Mapping[str, object]] = []
    for item in value:
        if isinstance(item, dict):
            items.append(item)
    return tuple(items)


def _evaluate_case(
    case: HindsightMemoryCase,
    observation: HindsightMemoryObservation | None,
) -> HindsightMemoryResult:
    if observation is None:
        return HindsightMemoryResult(
            case.case_id, False, "missing_observation", "missing observation"
        )
    if observation.schema_version != case.required_schema_version:
        return HindsightMemoryResult(
            case.case_id,
            False,
            "schema_version_mismatch",
            f"schema_version={observation.schema_version}",
        )
    if observation.status != case.required_status:
        return HindsightMemoryResult(
            case.case_id,
            False,
            "status_mismatch",
            f"status={observation.status}",
        )
    observed_tokens = set(observation.observed_tokens)
    for token in case.required_tokens:
        if token and token not in observed_tokens:
            return HindsightMemoryResult(
                case.case_id,
                False,
                "required_token_missing",
                f"required_token={token}",
            )
    forbidden_tokens = set(case.forbidden_tokens) | set(observation.forbidden_tokens)
    leaked = sorted(token for token in forbidden_tokens if token in observed_tokens)
    if leaked:
        return HindsightMemoryResult(
            case.case_id,
            False,
            "forbidden_token_present",
            f"forbidden_token={leaked[0]}",
        )
    if observation.selected_memory_count < case.min_selected_memory_count:
        return HindsightMemoryResult(
            case.case_id,
            False,
            "selected_memory_count_below_minimum",
            f"selected_memory_count={observation.selected_memory_count}",
        )
    return HindsightMemoryResult(case.case_id, True, "", "ok")


def _load_observations(path: Path | None) -> dict[str, HindsightMemoryObservation]:
    return {
        case_id: HindsightMemoryObservation(
            case_id=case_id,
            status=str(item.get("status") or ""),
            selected_memory_count=int(item.get("selected_memory_count") or 0),
            observed_tokens=string_tuple(item.get("observed_tokens")),
            forbidden_tokens=string_tuple(item.get("forbidden_tokens")),
            schema_version=str(item.get("schema_version") or ""),
            runtime_path=str(item.get("runtime_path") or ""),
        )
        for case_id, item in load_observation_mapping(path).items()
    }


def _parse_case(payload: object) -> HindsightMemoryCase:
    if not isinstance(payload, dict):
        raise ValueError("hindsight memory case must be an object")
    min_selected = int(payload.get("min_selected_memory_count") or 0)
    if min_selected < 0:
        raise ValueError("min_selected_memory_count must be non-negative")
    return HindsightMemoryCase(
        case_id=required_string(payload.get("case_id"), "case_id"),
        split=required_string(payload.get("split"), "split"),
        assertion_kind=required_string(payload.get("assertion_kind"), "assertion_kind"),
        required_schema_version=required_string(
            payload.get("required_schema_version"),
            "required_schema_version",
        ),
        required_status=required_string(payload.get("required_status"), "required_status"),
        required_tokens=string_tuple(payload.get("required_tokens")),
        forbidden_tokens=string_tuple(payload.get("forbidden_tokens")),
        min_selected_memory_count=min_selected,
    )


def _reject_duplicate_case_ids(case_ids: Sequence[str]) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate hindsight memory case_id: {case_id}")
        seen.add(case_id)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Hindsight memory product-path profile.")
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
        raise ValueError(
            "hindsight memory product-path gate is deterministic and requires reruns=1"
        )
    report = run_hindsight_memory_product_path_profile(
        output_dir=Path(args.output_dir),
        cases_path=Path(args.cases_path) if args.cases_path else None,
        observations_path=Path(args.observations_path) if args.observations_path else None,
        collect_runtime=bool(args.collect_runtime),
    )
    if args.json:
        print(report.output_path.read_text(encoding="utf-8").strip())
    elif args.verbose:
        print(f"hindsight-memory-product-path: {'PASS' if report.passed else 'FAIL'}")
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
