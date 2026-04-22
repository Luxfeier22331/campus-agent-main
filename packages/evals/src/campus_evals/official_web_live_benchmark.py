from __future__ import annotations

import argparse
import sys
from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path
from typing import Callable, Literal
from unittest.mock import patch

import campus_retrieval_core.backend_qdrant as backend_qdrant_module
import campus_retrieval_core.service as retrieval_service_module
from campus_contracts import (
    EvidenceBundle,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_rag_agent import delegate_to_rag_agent
from campus_retrieval_core import retrieve_sources

from campus_evals.handbook_benchmark import (
    repair_handbook_formal_benchmark,
    run_handbook_formal_benchmark,
)
from campus_evals.live_benchmark import (
    BenchmarkProfile,
    accept_live_benchmark_profile,
    build_default_profile_http_settings,
    build_parser_for_profile,
    main_for_profile,
)
from campus_evals.live_benchmark import (
    build_default_output_dir as build_shared_default_output_dir,
)
from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace
from campus_evals.scenarios import (
    official_web_fresh_news_release_gate_cases,
    official_web_release_gate_cases,
    official_web_stable_reference_release_gate_cases,
)

RUN_PREFIX = "official-web-live-gate"
REPAIR_PREFIX = "official-web-live-gate-repair"
STABLE_REFERENCE_RUN_PREFIX = "official-web-stable-reference-live-gate"
STABLE_REFERENCE_REPAIR_PREFIX = "official-web-stable-reference-live-gate-repair"
FRESH_NEWS_RUN_PREFIX = "official-web-fresh-news-live-gate"
FRESH_NEWS_REPAIR_PREFIX = "official-web-fresh-news-live-gate-repair"
OFFICIAL_WEB_LIVE_GATE_POLICY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "official_web_live_gate_policy.json"
)
OFFICIAL_WEB_SCOPE_CHOICES = ("mixed", "stable_reference", "fresh_news")
OfficialWebLiveScopeKey = Literal["mixed", "stable_reference", "fresh_news"]

Retriever = Callable[..., EvidenceBundle]
Delegate = Callable[..., SpecialistResponse]


def build_default_output_dir(*, prefix: str, timestamp: str | None = None) -> Path:
    return build_shared_default_output_dir(prefix=prefix, timestamp=timestamp)


def build_official_web_live_executor(
    *,
    retriever: Retriever = retrieve_sources,
    delegate: Delegate = delegate_to_rag_agent,
    qdrant_collection_name: str | None = None,
) -> Callable[[GoldenCase], ExecutionResult]:
    def _execute(case: GoldenCase) -> ExecutionResult:
        retrieved_evidence: EvidenceBundle | None = None
        retrieval_called = False

        def _traced_retriever(*args, **kwargs) -> EvidenceBundle:
            nonlocal retrieved_evidence, retrieval_called
            retrieval_called = True
            with _override_official_web_runtime_profile(
                scope=case.scope,
                qdrant_collection_name=qdrant_collection_name,
            ):
                retrieved_evidence = retriever(*args, **kwargs)
            return retrieved_evidence

        request = SpecialistRequest(
            target="rag-agent",
            user_goal=case.user_goal,
            payload=RagRequestPayload(scope=case.scope),
            actor=case.actor,
        )
        with _override_official_web_runtime_profile(
            scope=case.scope,
            qdrant_collection_name=qdrant_collection_name,
        ):
            response = delegate(request, retriever=_traced_retriever)
        supporting_sources = ()
        if isinstance(response.result, RagResultPayload):
            supporting_sources = tuple(response.result.evidence.sources)
        observed_trace = ObservedTrace(
            selected_scope=case.scope,
            retrieval_called=retrieval_called,
            clarification_emitted=response.status == "needs_clarification",
            error_path=response.status == "error",
            retrieved_sources=()
            if retrieved_evidence is None
            else tuple(retrieved_evidence.sources),
            supporting_sources=supporting_sources,
        )
        return ExecutionResult(response=response, observed_trace=observed_trace)

    return _execute


def build_parser() -> argparse.ArgumentParser:
    parser = build_parser_for_profile(build_official_web_live_profile())
    for action in parser._actions:
        if not isinstance(action, argparse._SubParsersAction):
            continue
        for subparser in action.choices.values():
            subparser.add_argument(
                "--official-web-scope",
                choices=OFFICIAL_WEB_SCOPE_CHOICES,
                default="mixed",
                help="Select the repo-tracked official_web eval scope to validate.",
            )
            subparser.add_argument(
                "--qdrant-collection-name",
                help="Physical Qdrant collection name used only for this local official_web validation run.",
            )
        break
    return parser


def build_official_web_live_profile(
    *,
    qdrant_collection_name: str | None = None,
    scope_key: OfficialWebLiveScopeKey = "mixed",
) -> BenchmarkProfile:
    profile_spec = _build_profile_spec(scope_key)
    http_settings = build_default_profile_http_settings()
    return BenchmarkProfile(
        profile_id=profile_spec["profile_id"],
        benchmark_type=profile_spec["benchmark_type"],
        repair_benchmark_type=profile_spec["repair_benchmark_type"],
        run_prefix=profile_spec["run_prefix"],
        repair_prefix=profile_spec["repair_prefix"],
        description=profile_spec["description"],
        policy_path=OFFICIAL_WEB_LIVE_GATE_POLICY_PATH,
        http_settings=http_settings,
        cases_factory=profile_spec["cases_factory"],
        executor_factory=lambda: build_official_web_live_executor(
            qdrant_collection_name=qdrant_collection_name,
        ),
        supplemental_adapters_factory=lambda: (),
    )


def main(argv: list[str] | None = None) -> int:
    incoming_argv = list(argv) if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(incoming_argv)
    profile = build_official_web_live_profile(
        qdrant_collection_name=args.qdrant_collection_name,
        scope_key=args.official_web_scope,
    )
    forwarded_argv = _strip_official_web_profile_args(incoming_argv)
    return main_for_profile(
        profile=profile,
        argv=forwarded_argv,
        output_dir_builder=build_default_output_dir,
        run_benchmark_fn=run_handbook_formal_benchmark,
        repair_benchmark_fn=repair_handbook_formal_benchmark,
        accept_benchmark_fn=accept_live_benchmark_profile,
    )


def _strip_official_web_profile_args(argv: list[str]) -> list[str]:
    forwarded: list[str] = []
    skip_next = False
    for token in argv:
        if skip_next:
            skip_next = False
            continue
        if token == "--official-web-scope":
            skip_next = True
            continue
        if token.startswith("--official-web-scope="):
            continue
        if token == "--qdrant-collection-name":
            skip_next = True
            continue
        if token.startswith("--qdrant-collection-name="):
            continue
        forwarded.append(token)
    return forwarded


def _build_profile_spec(scope_key: OfficialWebLiveScopeKey) -> dict[str, object]:
    if scope_key == "mixed":
        return {
            "profile_id": "official_web",
            "benchmark_type": "official_web_live_gate",
            "repair_benchmark_type": "official_web_live_gate_repair",
            "run_prefix": RUN_PREFIX,
            "repair_prefix": REPAIR_PREFIX,
            "description": "Run or repair official_web mixed live benchmark against a specified physical collection.",
            "cases_factory": official_web_release_gate_cases,
        }
    if scope_key == "stable_reference":
        return {
            "profile_id": "official_web_stable_reference",
            "benchmark_type": "official_web_stable_reference_live_gate",
            "repair_benchmark_type": "official_web_stable_reference_live_gate_repair",
            "run_prefix": STABLE_REFERENCE_RUN_PREFIX,
            "repair_prefix": STABLE_REFERENCE_REPAIR_PREFIX,
            "description": "Run or repair official_web stable_reference live benchmark against a specified physical collection.",
            "cases_factory": official_web_stable_reference_release_gate_cases,
        }
    if scope_key == "fresh_news":
        return {
            "profile_id": "official_web_fresh_news",
            "benchmark_type": "official_web_fresh_news_live_gate",
            "repair_benchmark_type": "official_web_fresh_news_live_gate_repair",
            "run_prefix": FRESH_NEWS_RUN_PREFIX,
            "repair_prefix": FRESH_NEWS_REPAIR_PREFIX,
            "description": "Run or repair official_web fresh_news seed live benchmark against a specified physical collection.",
            "cases_factory": official_web_fresh_news_release_gate_cases,
        }
    raise ValueError(f"unsupported official_web live scope: {scope_key}")


def _override_official_web_runtime_profile(
    *,
    scope,
    qdrant_collection_name: str | None,
):
    if qdrant_collection_name is None:
        return ExitStack()

    original_backend = backend_qdrant_module.load_runtime_profile
    original_service = retrieval_service_module.load_runtime_profile

    def _build_override(orig):
        def _load_runtime_profile(corpus: str, collection: str, *, config_root=None):
            profile = orig(corpus, collection, config_root=config_root)
            if corpus != scope.corpus or collection != scope.collection:
                return profile
            return replace(
                profile,
                retrieval_enabled=True,
                qdrant_index_binding=replace(
                    profile.qdrant_index_binding, alias_name=qdrant_collection_name
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
    return stack


if __name__ == "__main__":
    raise SystemExit(main())
