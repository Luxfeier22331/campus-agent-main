from __future__ import annotations

import copy
import json
import math
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterator

from campus_evals.runtime_observability import bind_runtime_event_context, emit_runtime_event

FAITHFULNESS_METRIC_KEY = "ragas.faithfulness"
FAITHFULNESS_RUNTIME_VERSION = "staged-v1"
FAITHFULNESS_CHECKPOINT_SCHEMA_VERSION = 1
FAITHFULNESS_NLI_BATCH_SIZE = 4


@dataclass(frozen=True, slots=True)
class FaithfulnessArtifactContext:
    output_dir: Path
    run_number: int
    benchmark_mode: str
    source_output_dir: Path | None = None


@dataclass(frozen=True, slots=True)
class FaithfulnessStageExecution:
    value: float | None
    metadata: dict[str, object]


class FaithfulnessRuntimeError(RuntimeError):
    def __init__(
        self,
        *,
        stage: str,
        cause: Exception,
        checkpoint_path: Path | None,
        source_checkpoint_path: Path | None,
        sample_hash: str,
        statement_count: int,
        completed_batch_count: int,
        remaining_batch_count: int,
    ) -> None:
        super().__init__(f"faithfulness stage {stage} failed: {cause}")
        self.faithfulness_stage = stage
        self.checkpoint_path = str(checkpoint_path) if checkpoint_path is not None else ""
        self.source_checkpoint_path = (
            str(source_checkpoint_path) if source_checkpoint_path is not None else ""
        )
        self.sample_hash = sample_hash
        self.statement_count = statement_count
        self.completed_batch_count = completed_batch_count
        self.remaining_batch_count = remaining_batch_count
        copied_reasons = False
        copied_disposition = False
        for attr in ("reasons", "disposition", "provider_origin", "http_status", "request_id"):
            value = getattr(cause, attr, None)
            if value not in (None, "", (), []):
                setattr(self, attr, value)
                if attr == "reasons":
                    copied_reasons = True
                if attr == "disposition":
                    copied_disposition = True
        if not copied_reasons or not copied_disposition:
            from campus_evals.supplemental_http import classify_runtime_failure

            classification = classify_runtime_failure(str(cause), error_type=type(cause).__name__)
            if not copied_reasons and classification.reasons:
                self.reasons = classification.reasons
            if not copied_disposition and classification.disposition:
                self.disposition = classification.disposition


_CURRENT_FAITHFULNESS_ARTIFACT_CONTEXT: ContextVar[FaithfulnessArtifactContext | None] = ContextVar(
    "campus_evals_faithfulness_artifact_context",
    default=None,
)


@contextmanager
def bind_faithfulness_artifact_context(
    *,
    output_dir: str | Path,
    run_number: int,
    benchmark_mode: str,
    source_output_dir: str | Path | None = None,
) -> Iterator[FaithfulnessArtifactContext]:
    context = FaithfulnessArtifactContext(
        output_dir=Path(output_dir),
        run_number=run_number,
        benchmark_mode=benchmark_mode,
        source_output_dir=Path(source_output_dir) if source_output_dir is not None else None,
    )
    token: Token[FaithfulnessArtifactContext | None] = _CURRENT_FAITHFULNESS_ARTIFACT_CONTEXT.set(
        context
    )
    try:
        yield context
    finally:
        _CURRENT_FAITHFULNESS_ARTIFACT_CONTEXT.reset(token)


def current_faithfulness_artifact_context() -> FaithfulnessArtifactContext | None:
    return _CURRENT_FAITHFULNESS_ARTIFACT_CONTEXT.get()


def supports_staged_faithfulness(metric: object) -> bool:
    return (
        getattr(metric, "name", "") == "faithfulness"
        and hasattr(metric, "_create_statements")
        and hasattr(metric, "_create_verdicts")
        and hasattr(metric, "_compute_score")
        and hasattr(metric, "init")
    )


def execute_staged_faithfulness(
    *,
    metric: object,
    projection: object,
    run_config: object,
) -> FaithfulnessStageExecution:
    from ragas.async_utils import run as ragas_run
    from ragas.metrics._faithfulness import NLIStatementOutput, StatementFaithfulnessAnswer

    metric.init(_run_config_for_metric(metric, run_config))
    sample_hash = _projection_sample_hash(projection)
    nli_batch_size = _resolve_faithfulness_nli_batch_size(metric)
    prompt_version = _prompt_version(metric, nli_batch_size=nli_batch_size)
    checkpoint_context = current_faithfulness_artifact_context()
    checkpoint_path = (
        _checkpoint_path(
            checkpoint_context.output_dir,
            checkpoint_context.run_number,
            getattr(projection, "case_id"),
        )
        if checkpoint_context is not None
        else None
    )
    source_checkpoint_path = (
        _checkpoint_path(
            checkpoint_context.source_output_dir,
            checkpoint_context.run_number,
            getattr(projection, "case_id"),
        )
        if checkpoint_context is not None and checkpoint_context.source_output_dir is not None
        else None
    )
    state, loaded_from = _load_checkpoint_state(
        checkpoint_path=checkpoint_path,
        source_checkpoint_path=source_checkpoint_path,
        case_id=getattr(projection, "case_id"),
        sample_hash=sample_hash,
        prompt_version=prompt_version,
    )
    if state is None:
        state = _build_initial_state(
            case_id=getattr(projection, "case_id"),
            sample_hash=sample_hash,
            prompt_version=prompt_version,
            nli_batch_size=nli_batch_size,
        )
    if checkpoint_path is not None and loaded_from is not None and loaded_from != checkpoint_path:
        _write_checkpoint(checkpoint_path, state)

    row = {
        "user_input": getattr(projection, "user_input"),
        "response": getattr(projection, "response"),
        "retrieved_contexts": list(getattr(projection, "retrieved_contexts")),
    }

    statement_stage = dict(state["stages"]["statement_generation"])
    statements = [str(item) for item in statement_stage.get("statements") or ()]
    if statement_stage.get("status") == "completed":
        _emit_checkpoint_hit(
            stage="statement_generation",
            checkpoint_path=checkpoint_path or loaded_from,
            source_checkpoint_path=loaded_from if loaded_from != checkpoint_path else None,
        )
    else:
        try:
            with (
                bind_runtime_event_context(
                    adapter_id="ragas",
                    metric_name="faithfulness",
                    faithfulness_stage="statement_generation",
                    checkpoint_hit=False,
                ),
                _bind_metric_stage_http_settings(metric, stage_name="statement_generation"),
            ):
                generated = ragas_run(lambda: metric._create_statements(row, callbacks=None))
        except Exception as exc:
            _mark_stage_failed(state, stage_name="statement_generation")
            _write_checkpoint(checkpoint_path, state)
            raise FaithfulnessRuntimeError(
                stage="statement_generation",
                cause=exc,
                checkpoint_path=checkpoint_path,
                source_checkpoint_path=loaded_from if loaded_from != checkpoint_path else None,
                sample_hash=sample_hash,
                statement_count=0,
                completed_batch_count=0,
                remaining_batch_count=0,
            ) from exc
        statements = [str(item) for item in generated.statements]
        state["stages"]["statement_generation"] = {
            "status": "completed",
            "statements": statements,
            "statement_count": len(statements),
        }
        _write_checkpoint(checkpoint_path, state)

    verdict_stage = dict(state["stages"]["nli_verdicts"])
    total_batches = _total_batches(len(statements), nli_batch_size)
    completed_batches = {
        str(key): [dict(item) for item in value]
        for key, value in dict(verdict_stage.get("batches") or {}).items()
    }

    if not statements:
        state["stages"]["nli_verdicts"] = {
            "status": "completed",
            "batch_size": nli_batch_size,
            "total_batches": 0,
            "batches": {},
        }
        state["stages"]["score_aggregation"] = {
            "status": "completed",
            "score": None,
        }
        _write_checkpoint(checkpoint_path, state)
        return FaithfulnessStageExecution(
            value=None,
            metadata=_result_metadata(
                checkpoint_path=checkpoint_path,
                source_checkpoint_path=loaded_from if loaded_from != checkpoint_path else None,
                sample_hash=sample_hash,
                statement_count=0,
                completed_batch_count=0,
                remaining_batch_count=0,
            ),
        )

    for batch_index in range(total_batches):
        batch_key = str(batch_index)
        batch_statements = _statement_batch(
            statements,
            batch_index=batch_index,
            batch_size=nli_batch_size,
        )
        cached_batch = completed_batches.get(batch_key)
        if cached_batch is not None and len(cached_batch) == len(batch_statements):
            _emit_checkpoint_hit(
                stage="nli_verdicts",
                checkpoint_path=checkpoint_path or loaded_from,
                source_checkpoint_path=loaded_from if loaded_from != checkpoint_path else None,
                batch_index=batch_index + 1,
            )
            continue
        try:
            with (
                bind_runtime_event_context(
                    adapter_id="ragas",
                    metric_name="faithfulness",
                    faithfulness_stage="nli_verdicts",
                    checkpoint_hit=False,
                    batch_index=batch_index + 1,
                    statement_count=len(batch_statements),
                ),
                _bind_metric_stage_http_settings(metric, stage_name="nli_verdicts"),
            ):
                verdict_output = ragas_run(
                    lambda: metric._create_verdicts(row, batch_statements, callbacks=None)
                )
        except Exception as exc:
            state["stages"]["nli_verdicts"] = {
                "status": "partial" if completed_batches else "failed",
                "batch_size": nli_batch_size,
                "total_batches": total_batches,
                "batches": completed_batches,
            }
            _write_checkpoint(checkpoint_path, state)
            raise FaithfulnessRuntimeError(
                stage="nli_verdicts",
                cause=exc,
                checkpoint_path=checkpoint_path,
                source_checkpoint_path=loaded_from if loaded_from != checkpoint_path else None,
                sample_hash=sample_hash,
                statement_count=len(statements),
                completed_batch_count=len(completed_batches),
                remaining_batch_count=total_batches - len(completed_batches),
            ) from exc
        completed_batches[batch_key] = [
            item.model_dump(mode="python") for item in verdict_output.statements
        ]
        state["stages"]["nli_verdicts"] = {
            "status": "partial",
            "batch_size": nli_batch_size,
            "total_batches": total_batches,
            "batches": completed_batches,
        }
        _write_checkpoint(checkpoint_path, state)

    verdict_items = [
        StatementFaithfulnessAnswer.model_validate(item)
        for item in _flatten_batches(completed_batches, total_batches=total_batches)
    ]
    verdict_output = NLIStatementOutput(statements=verdict_items)
    score = metric._compute_score(verdict_output)
    numeric_score = None if score is None or math.isnan(float(score)) else float(score)

    state["stages"]["nli_verdicts"] = {
        "status": "completed",
        "batch_size": nli_batch_size,
        "total_batches": total_batches,
        "batches": completed_batches,
    }
    state["stages"]["score_aggregation"] = {
        "status": "completed",
        "score": numeric_score,
    }
    _write_checkpoint(checkpoint_path, state)
    return FaithfulnessStageExecution(
        value=numeric_score,
        metadata=_result_metadata(
            checkpoint_path=checkpoint_path,
            source_checkpoint_path=loaded_from if loaded_from != checkpoint_path else None,
            sample_hash=sample_hash,
            statement_count=len(statements),
            completed_batch_count=len(completed_batches),
            remaining_batch_count=0,
        ),
    )


def _build_initial_state(
    *,
    case_id: str,
    sample_hash: str,
    prompt_version: str,
    nli_batch_size: int,
) -> dict[str, object]:
    return {
        "schema_version": FAITHFULNESS_CHECKPOINT_SCHEMA_VERSION,
        "metric_key": FAITHFULNESS_METRIC_KEY,
        "metric_version": FAITHFULNESS_RUNTIME_VERSION,
        "case_id": case_id,
        "sample_hash": sample_hash,
        "prompt_version": prompt_version,
        "stages": {
            "statement_generation": {
                "status": "pending",
                "statements": [],
                "statement_count": 0,
            },
            "nli_verdicts": {
                "status": "pending",
                "batch_size": nli_batch_size,
                "total_batches": 0,
                "batches": {},
            },
            "score_aggregation": {
                "status": "pending",
                "score": None,
            },
        },
    }


def _mark_stage_failed(state: dict[str, object], *, stage_name: str) -> None:
    stages = dict(state.get("stages") or {})
    stage = dict(stages.get(stage_name) or {})
    stage["status"] = "failed"
    stages[stage_name] = stage
    state["stages"] = stages


def _run_config_for_metric(metric: object, run_config: object) -> object:
    timeout_seconds = int(getattr(run_config, "timeout", 0) or 0)
    for stage_name in ("statement_generation", "nli_verdicts"):
        stage_http_settings = _metric_stage_http_settings(metric, stage_name=stage_name)
        if stage_http_settings is None:
            continue
        timeout_seconds = max(
            timeout_seconds, int(math.ceil(stage_http_settings.read_timeout_seconds))
        )
    current_timeout = int(getattr(run_config, "timeout", 0) or 0)
    if timeout_seconds <= current_timeout:
        return run_config
    cloned = copy.copy(run_config)
    setattr(cloned, "timeout", timeout_seconds)
    return cloned


@contextmanager
def _bind_metric_stage_http_settings(metric: object, *, stage_name: str) -> Iterator[None]:
    llm = getattr(metric, "llm", None)
    stage_http_settings = _metric_stage_http_settings(metric, stage_name=stage_name)
    if llm is None or stage_http_settings is None or not hasattr(llm, "http_settings"):
        yield
        return
    original_http_settings = getattr(llm, "http_settings", None)
    if original_http_settings == stage_http_settings:
        yield
        return
    setattr(llm, "http_settings", stage_http_settings)
    try:
        yield
    finally:
        setattr(llm, "http_settings", original_http_settings)


def _metric_stage_http_settings(metric: object, *, stage_name: str):
    stage_http_settings = getattr(metric, "_campus_stage_http_settings", None)
    if not isinstance(stage_http_settings, dict):
        return None
    return stage_http_settings.get(stage_name)


def _resolve_faithfulness_nli_batch_size(metric: object) -> int:
    batch_size = getattr(metric, "_campus_faithfulness_nli_batch_size", None)
    if isinstance(batch_size, int) and batch_size > 0:
        return batch_size
    return FAITHFULNESS_NLI_BATCH_SIZE


def _projection_sample_hash(projection: object) -> str:
    payload = {
        "case_id": getattr(projection, "case_id"),
        "user_input": getattr(projection, "user_input"),
        "response": getattr(projection, "response"),
        "retrieved_contexts": list(getattr(projection, "retrieved_contexts")),
        "reference": getattr(projection, "reference"),
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(serialized.encode("utf-8")).hexdigest()


def _prompt_version(metric: object, *, nli_batch_size: int) -> str:
    payload = {
        "statement_instruction": getattr(
            getattr(metric, "statement_generator_prompt", None), "instruction", ""
        ),
        "statement_examples": repr(
            getattr(getattr(metric, "statement_generator_prompt", None), "examples", ())
        ),
        "nli_instruction": getattr(
            getattr(metric, "nli_statements_prompt", None), "instruction", ""
        ),
        "nli_examples": repr(
            getattr(getattr(metric, "nli_statements_prompt", None), "examples", ())
        ),
        "nli_batch_size": nli_batch_size,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(serialized.encode("utf-8")).hexdigest()


def _load_checkpoint_state(
    *,
    checkpoint_path: Path | None,
    source_checkpoint_path: Path | None,
    case_id: str,
    sample_hash: str,
    prompt_version: str,
) -> tuple[dict[str, object] | None, Path | None]:
    for candidate in (checkpoint_path, source_checkpoint_path):
        if candidate is None or not candidate.exists():
            continue
        payload = json.loads(candidate.read_text(encoding="utf-8"))
        if (
            not isinstance(payload, dict)
            or int(payload.get("schema_version") or 0) != FAITHFULNESS_CHECKPOINT_SCHEMA_VERSION
            or str(payload.get("metric_key") or "") != FAITHFULNESS_METRIC_KEY
            or str(payload.get("metric_version") or "") != FAITHFULNESS_RUNTIME_VERSION
            or str(payload.get("case_id") or "") != case_id
            or str(payload.get("sample_hash") or "") != sample_hash
            or str(payload.get("prompt_version") or "") != prompt_version
        ):
            continue
        return dict(payload), candidate
    return None, None


def _write_checkpoint(path: Path | None, payload: dict[str, object]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _checkpoint_path(output_dir: Path | None, run_number: int, case_id: str) -> Path | None:
    if output_dir is None:
        return None
    return (
        output_dir
        / "_supplemental_state"
        / f"run-{run_number:02d}"
        / case_id
        / "ragas.faithfulness.json"
    )


def _statement_batch(statements: list[str], *, batch_index: int, batch_size: int) -> list[str]:
    start = batch_index * batch_size
    return list(statements[start : start + batch_size])


def _total_batches(statement_count: int, batch_size: int) -> int:
    if statement_count <= 0:
        return 0
    return (statement_count + batch_size - 1) // batch_size


def _flatten_batches(
    batches: dict[str, list[dict[str, object]]], *, total_batches: int
) -> list[dict[str, object]]:
    flattened: list[dict[str, object]] = []
    for batch_index in range(total_batches):
        flattened.extend(dict(item) for item in batches.get(str(batch_index), ()))
    return flattened


def _emit_checkpoint_hit(
    *,
    stage: str,
    checkpoint_path: Path | None,
    source_checkpoint_path: Path | None,
    batch_index: int | None = None,
) -> None:
    emit_runtime_event(
        "faithfulness_checkpoint_hit",
        adapter_id="ragas",
        metric_name="faithfulness",
        faithfulness_stage=stage,
        checkpoint_path=str(checkpoint_path) if checkpoint_path is not None else None,
        source_checkpoint_path=(
            str(source_checkpoint_path) if source_checkpoint_path is not None else None
        ),
        batch_index=batch_index,
    )


def _result_metadata(
    *,
    checkpoint_path: Path | None,
    source_checkpoint_path: Path | None,
    sample_hash: str,
    statement_count: int,
    completed_batch_count: int,
    remaining_batch_count: int,
) -> dict[str, object]:
    metadata: dict[str, Any] = {
        "faithfulness_runtime": FAITHFULNESS_RUNTIME_VERSION,
        "sample_hash": sample_hash,
        "statement_count": statement_count,
        "completed_batch_count": completed_batch_count,
        "remaining_batch_count": remaining_batch_count,
    }
    if checkpoint_path is not None:
        metadata["checkpoint_path"] = str(checkpoint_path)
    if source_checkpoint_path is not None:
        metadata["source_checkpoint_path"] = str(source_checkpoint_path)
    return metadata
