from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Sequence
from contextlib import ExitStack
from dataclasses import asdict, replace
from pathlib import Path
from typing import Literal
from unittest.mock import patch

import campus_retrieval_core.backend_qdrant as backend_qdrant_module
import campus_retrieval_core.backend_qdrant_release_guard as release_guard_module
import campus_retrieval_core.service as retrieval_service_module
from campus_contracts import AgentRequest, AgentResponse, KnowledgeScope, RagRequestPayload
from campus_rag_agent import delegate_to_rag_agent
from campus_shared import load_repo_env

from campus_evals.answer_ready_component_eval import (
    AnswerReadyComponentCase,
    AnswerReadyComponentReport,
    evaluate_answer_ready_component_cases,
    load_answer_ready_component_cases,
)
from campus_evals.answer_ready_component_runtime import (
    AnswerReadyComponentRuntimeArtifact,
    collect_answer_ready_component_runtime_observations,
)

SupportedRegulationCollection = Literal["student_rules", "institutional_rules"]
Delegate = Callable[..., AgentResponse]
RetrievalObservationSink = Callable[[dict[str, object]], None]


def build_runtime_artifacts(
    *,
    cases: Sequence[AnswerReadyComponentCase],
    collection: SupportedRegulationCollection,
    delegate: Delegate = delegate_to_rag_agent,
    qdrant_collection_name: str | None = None,
    release_contract_status: str = "passed",
    release_contract_failure_classes: Sequence[str] = (),
) -> tuple[AnswerReadyComponentRuntimeArtifact, ...]:
    scope = KnowledgeScope(corpus="regulations", collection=collection)
    artifacts: list[AnswerReadyComponentRuntimeArtifact] = []
    for case in cases:
        if case.collection != collection:
            continue
        retrieval_observations: list[dict[str, object]] = []

        def _observation_sink(
            observation: dict[str, object],
            _retrieval_observations: list[dict[str, object]] = retrieval_observations,
        ) -> None:
            _retrieval_observations.append(dict(observation))

        request = AgentRequest(
            target="rag-agent",
            user_goal=case.query,
            payload=RagRequestPayload(scope=scope),
            request_id=case.case_id,
        )
        with _override_regulation_runtime_profile(
            scope=scope,
            qdrant_collection_name=qdrant_collection_name,
        ):
            response = delegate(
                request,
                retrieval_observation_sink=_observation_sink,
                include_retrieval_observation_query_text=True,
            )
        artifacts.append(
            AnswerReadyComponentRuntimeArtifact(
                case_id=case.case_id,
                query=case.query,
                response=response,
                retrieval_runtime_observations=tuple(retrieval_observations),
                release_contract_status=release_contract_status.strip(),
                release_contract_failure_classes=tuple(
                    item.strip() for item in release_contract_failure_classes if str(item).strip()
                ),
            )
        )
    if not artifacts:
        raise ValueError(f"no answer-ready component cases found for collection {collection}")
    return tuple(artifacts)


def run_component_eval_for_collection(
    *,
    collection: SupportedRegulationCollection,
    summary_output_path: str | Path,
    retrieval_observations_output_path: str | Path | None = None,
    delegate: Delegate = delegate_to_rag_agent,
    qdrant_collection_name: str | None = None,
    release_contract_status: str = "passed",
    release_contract_failure_classes: Sequence[str] = (),
    repo_env: bool = True,
) -> AnswerReadyComponentReport:
    if repo_env:
        load_repo_env()
    case_set = load_answer_ready_component_cases()
    artifacts = build_runtime_artifacts(
        cases=case_set.cases,
        collection=collection,
        delegate=delegate,
        qdrant_collection_name=qdrant_collection_name,
        release_contract_status=release_contract_status,
        release_contract_failure_classes=release_contract_failure_classes,
    )
    observation_set = collect_answer_ready_component_runtime_observations(artifacts)
    if retrieval_observations_output_path is not None:
        _write_retrieval_observations_jsonl(
            path=Path(retrieval_observations_output_path),
            artifacts=artifacts,
        )
    filtered_cases = tuple(case for case in case_set.cases if case.collection == collection)
    return evaluate_answer_ready_component_cases(
        filtered_cases,
        observation_set.observations,
        output_path=Path(summary_output_path),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run live answer-ready component eval for a regulation collection."
    )
    parser.add_argument(
        "--collection", choices=("student_rules", "institutional_rules"), required=True
    )
    parser.add_argument("--summary-output-path", required=True)
    parser.add_argument("--retrieval-observations-output-path")
    parser.add_argument("--qdrant-collection-name")
    parser.add_argument("--release-contract-status", default="passed")
    parser.add_argument("--release-contract-failure-class", action="append", default=[])
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = run_component_eval_for_collection(
        collection=args.collection,
        summary_output_path=args.summary_output_path,
        retrieval_observations_output_path=args.retrieval_observations_output_path,
        qdrant_collection_name=args.qdrant_collection_name,
        release_contract_status=args.release_contract_status,
        release_contract_failure_classes=tuple(args.release_contract_failure_class),
    )
    payload = {
        "schema_version": "regulation_answer_ready_component_live_runner.v1",
        "collection": args.collection,
        "summary_output_path": str(Path(args.summary_output_path)),
        "retrieval_observations_output_path": (
            str(Path(args.retrieval_observations_output_path))
            if args.retrieval_observations_output_path
            else ""
        ),
        "qdrant_collection_name": args.qdrant_collection_name or "",
        "report": asdict(report),
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if report.passed else 1


def _write_retrieval_observations_jsonl(
    *,
    path: Path,
    artifacts: Sequence[AnswerReadyComponentRuntimeArtifact],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for artifact in artifacts:
        for observation in artifact.retrieval_runtime_observations:
            payload = {
                "case_id": artifact.case_id,
                "query": artifact.query,
                **dict(observation),
            }
            lines.append(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    path.write_text(("\n".join(lines) + ("\n" if lines else "")), encoding="utf-8")


def _override_regulation_runtime_profile(
    *,
    scope: KnowledgeScope,
    qdrant_collection_name: str | None,
):
    if qdrant_collection_name is None:
        return ExitStack()

    original_backend = backend_qdrant_module.load_runtime_profile
    original_service = retrieval_service_module.load_runtime_profile

    def _build_override(loader):
        def _load_runtime_profile(corpus: str, collection: str, *, config_root=None):
            profile = loader(corpus, collection, config_root=config_root)
            if corpus != scope.corpus or collection != scope.collection:
                return profile
            return replace(
                profile,
                retrieval_enabled=True,
                qdrant_index_binding=replace(
                    profile.qdrant_index_binding,
                    alias_name=qdrant_collection_name,
                ),
            )

        return _load_runtime_profile

    stack = ExitStack()
    stack.enter_context(
        patch.object(
            backend_qdrant_module,
            "load_runtime_profile",
            side_effect=_build_override(original_backend),
        )
    )
    stack.enter_context(
        patch.object(
            retrieval_service_module,
            "load_runtime_profile",
            side_effect=_build_override(original_service),
        )
    )
    stack.enter_context(
        patch.object(
            release_guard_module,
            "_requires_regulation_target_release_proof",
            side_effect=_build_preview_release_guard_override(
                original=release_guard_module._requires_regulation_target_release_proof,
                scope=scope,
                qdrant_collection_name=qdrant_collection_name,
            ),
        )
    )
    stack.enter_context(
        patch.object(
            backend_qdrant_module,
            "validate_alias_release_metadata",
            side_effect=_build_preview_release_metadata_validation_override(
                original=backend_qdrant_module.validate_alias_release_metadata,
                scope=scope,
                qdrant_collection_name=qdrant_collection_name,
                default_alias_name=original_backend(
                    scope.corpus, scope.collection
                ).qdrant_index_binding.alias_name,
            ),
        )
    )
    return stack


def _build_preview_release_guard_override(
    *,
    original,
    scope: KnowledgeScope,
    qdrant_collection_name: str,
):
    def _requires_regulation_target_release_proof(profile) -> bool:
        if (
            profile.corpus == scope.corpus
            and profile.collection == scope.collection
            and qdrant_collection_name
            and qdrant_collection_name == profile.qdrant_index_binding.alias_name
        ):
            return False
        return original(profile)

    return _requires_regulation_target_release_proof


def _build_preview_release_metadata_validation_override(
    *,
    original,
    scope: KnowledgeScope,
    qdrant_collection_name: str,
    default_alias_name: str,
):
    def _validate_alias_release_metadata(
        backend,
        *,
        collection_name: str,
        profile,
        settings,
        timeout_seconds: int | None,
    ) -> None:
        if (
            profile.corpus == scope.corpus
            and profile.collection == scope.collection
            and qdrant_collection_name
            and collection_name == qdrant_collection_name
            and profile.qdrant_index_binding.alias_name == qdrant_collection_name
            and qdrant_collection_name != default_alias_name
        ):
            return None
        return original(
            backend,
            collection_name=collection_name,
            profile=profile,
            settings=settings,
            timeout_seconds=timeout_seconds,
        )

    return _validate_alias_release_metadata


__all__ = [
    "build_parser",
    "build_runtime_artifacts",
    "main",
    "run_component_eval_for_collection",
]


if __name__ == "__main__":
    raise SystemExit(main())
