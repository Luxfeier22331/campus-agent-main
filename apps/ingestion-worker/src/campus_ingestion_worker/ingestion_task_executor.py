from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable, Mapping
from typing import Any, Protocol
from urllib import request as urlrequest

from campus_ingestion_contracts import validate_ingestion_task_envelope

AdapterResult = Mapping[str, Any]
PythonAdapter = Callable[[Mapping[str, Any]], AdapterResult]


class IngestionControlClient(Protocol):
    def claim_next_task(self, *, worker_id: str) -> Mapping[str, Any] | None: ...

    def heartbeat_task(self, *, task_id: str, worker_id: str) -> Mapping[str, Any]: ...

    def complete_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        artifact_refs: list[Mapping[str, Any]],
    ) -> Mapping[str, Any]: ...

    def fail_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        error_code: str,
        error_message: str,
    ) -> Mapping[str, Any]: ...


class HttpTransport(Protocol):
    def request(
        self, method: str, url: str, json: Mapping[str, Any]
    ) -> tuple[int, Mapping[str, Any]]: ...


class UrllibJsonTransport:
    def request(
        self, method: str, url: str, json: Mapping[str, Any]
    ) -> tuple[int, Mapping[str, Any]]:
        data = _json_bytes(json)
        request = urlrequest.Request(
            url,
            data=data,
            method=method,
            headers={"content-type": "application/json"},
        )
        with urlrequest.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
            body = json_loads_mapping(payload)
            return int(response.status), body


class HttpIngestionControlClient:
    def __init__(self, *, base_url: str, transport: HttpTransport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._transport = transport or UrllibJsonTransport()

    def claim_next_task(self, *, worker_id: str) -> Mapping[str, Any] | None:
        status, body = self._request(
            "POST",
            "/internal/ingestion/tasks/claim",
            {"worker_id": worker_id},
        )
        if status == 204:
            return None
        return body

    def complete_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        artifact_refs: list[Mapping[str, Any]],
    ) -> Mapping[str, Any]:
        return self._request(
            "POST",
            f"/internal/ingestion/tasks/{task_id}/complete",
            {"worker_id": worker_id, "artifact_refs": artifact_refs},
        )[1]

    def heartbeat_task(self, *, task_id: str, worker_id: str) -> Mapping[str, Any]:
        return self._request(
            "POST",
            f"/internal/ingestion/tasks/{task_id}/heartbeat",
            {"worker_id": worker_id},
        )[1]

    def fail_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        error_code: str,
        error_message: str,
    ) -> Mapping[str, Any]:
        return self._request(
            "POST",
            f"/internal/ingestion/tasks/{task_id}/fail",
            {
                "worker_id": worker_id,
                "error_code": error_code,
                "error_message": error_message,
            },
        )[1]

    def _request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any],
    ) -> tuple[int, Mapping[str, Any]]:
        status, body = self._transport.request(method, f"{self._base_url}{path}", payload)
        if status >= 400:
            message = body.get("error") if isinstance(body.get("error"), str) else "request failed"
            raise RuntimeError(f"ingestion-control HTTP {status}: {message}")
        return status, body


class PythonAdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, PythonAdapter] = {}

    def register(self, adapter_id: str, adapter: PythonAdapter) -> None:
        normalized = _normalize_adapter_id(adapter_id)
        if normalized in self._adapters:
            raise ValueError(f"python adapter already registered: {normalized}")
        self._adapters[normalized] = adapter

    def require(self, adapter_id: str) -> PythonAdapter:
        normalized = _normalize_adapter_id(adapter_id)
        adapter = self._adapters.get(normalized)
        if adapter is None:
            raise AdapterNotRegisteredError(normalized)
        return adapter


class AdapterNotRegisteredError(ValueError):
    pass


class IngestionTaskExecutor:
    def __init__(
        self,
        *,
        control_client: IngestionControlClient,
        adapter_registry: PythonAdapterRegistry,
        worker_id: str,
    ) -> None:
        self._control_client = control_client
        self._adapter_registry = adapter_registry
        self._worker_id = worker_id

    def run_once(self) -> Mapping[str, Any]:
        task = self._control_client.claim_next_task(worker_id=self._worker_id)
        if task is None:
            return {"status": "idle"}

        task_id = _task_id_for_closeout(task)
        validation = validate_ingestion_task_envelope(task)
        if not validation.ok:
            return self._fail(
                task_id=task_id,
                error_code="invalid_task_payload",
                error_message="; ".join(validation.errors),
            )

        adapter_id = _resolve_adapter_id(task)
        try:
            adapter = self._adapter_registry.require(adapter_id)
            adapter_result = adapter(task)
        except AdapterNotRegisteredError as exc:
            return self._fail(
                task_id=task_id,
                error_code="adapter_not_registered",
                error_message=str(exc),
            )
        except Exception as exc:
            return self._fail(
                task_id=task_id,
                error_code="adapter_execution_failed",
                error_message=str(exc),
            )

        artifact_refs = _normalize_artifact_refs(adapter_result.get("artifact_refs"))
        completed = self._control_client.complete_task(
            task_id=task_id,
            worker_id=self._worker_id,
            artifact_refs=artifact_refs,
        )
        return {"status": "completed", "task": completed}

    def _fail(self, *, task_id: str, error_code: str, error_message: str) -> Mapping[str, Any]:
        failed = self._control_client.fail_task(
            task_id=task_id,
            worker_id=self._worker_id,
            error_code=error_code,
            error_message=error_message,
        )
        return {"status": "failed", "task": failed}


class InMemoryIngestionControlClient:
    def __init__(self, *, tasks: list[dict[str, Any]]) -> None:
        self._queued = list(tasks)
        self._claimed: dict[str, dict[str, Any]] = {}
        self.completed: list[Mapping[str, Any]] = []
        self.failed: list[Mapping[str, Any]] = []

    def claim_next_task(self, *, worker_id: str) -> Mapping[str, Any] | None:
        if not self._queued:
            return None
        task = self._queued.pop(0)
        task["leased_by"] = worker_id
        self._claimed[_task_id_for_closeout(task)] = task
        return task

    def complete_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        artifact_refs: list[Mapping[str, Any]],
    ) -> Mapping[str, Any]:
        self._require_claimed(task_id=task_id, worker_id=worker_id)
        closeout = {
            "task_id": task_id,
            "terminal_status": "completed",
            "artifact_refs": artifact_refs,
        }
        self.completed.append(closeout)
        return closeout

    def heartbeat_task(self, *, task_id: str, worker_id: str) -> Mapping[str, Any]:
        self._require_claimed(task_id=task_id, worker_id=worker_id)
        return {"task_id": task_id, "terminal_status": "running"}

    def fail_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        error_code: str,
        error_message: str,
    ) -> Mapping[str, Any]:
        self._require_claimed(task_id=task_id, worker_id=worker_id)
        closeout = {
            "task_id": task_id,
            "terminal_status": "failed",
            "error_code": error_code,
            "error_message": error_message,
        }
        self.failed.append(closeout)
        return closeout

    def _require_claimed(self, *, task_id: str, worker_id: str) -> Mapping[str, Any]:
        task = self._claimed.get(task_id)
        if task is None or task.get("leased_by") != worker_id:
            raise ValueError(f"task is not claimed by worker: {task_id}")
        return task


def _resolve_adapter_id(task: Mapping[str, Any]) -> str:
    explicit = task.get("adapter_id")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    return f"{task['corpus']}.{task['task_kind']}.v1"


def _normalize_adapter_id(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("python adapter id is required")
    return normalized


def _normalize_artifact_refs(value: object) -> list[Mapping[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("adapter artifact_refs must be a list")
    normalized: list[Mapping[str, Any]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise ValueError("adapter artifact_refs entries must be objects")
        normalized.append(item)
    return normalized


def _task_id_for_closeout(task: Mapping[str, Any]) -> str:
    task_id = task.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        return "unknown"
    return task_id


def _json_bytes(value: Mapping[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def json_loads_mapping(payload: str) -> Mapping[str, Any]:
    loaded = json.loads(payload or "{}")
    if not isinstance(loaded, Mapping):
        raise ValueError("ingestion-control response must be a JSON object")
    return loaded


def build_executor_from_env(
    *,
    env: Mapping[str, str] | None = None,
    registry: PythonAdapterRegistry | None = None,
) -> IngestionTaskExecutor:
    source = env or os.environ
    base_url = _required_env(source, "INGESTION_CONTROL_BASE_URL")
    worker_id = source.get("INGESTION_WORKER_ID", "").strip() or "ingestion-worker-python"
    return IngestionTaskExecutor(
        control_client=HttpIngestionControlClient(base_url=base_url),
        adapter_registry=registry or PythonAdapterRegistry(),
        worker_id=worker_id,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one ingestion-control Python adapter task.")
    parser.add_argument(
        "--adapter-id",
        action="append",
        default=[],
        help="Allowed placeholder adapter id for smoke wiring. Real adapters must register explicitly.",
    )
    args = parser.parse_args(argv)
    registry = PythonAdapterRegistry()
    for adapter_id in args.adapter_id:
        registry.register(adapter_id, _placeholder_adapter)
    result = build_executor_from_env(registry=registry).run_once()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("status") in {"idle", "completed"} else 1


def _placeholder_adapter(task: Mapping[str, Any]) -> Mapping[str, Any]:
    return {
        "artifact_refs": [
            {
                "kind": "inline",
                "uri": f"adapter://{task['corpus']}/{task['collection']}/{task['task_kind']}",
            }
        ]
    }


def _required_env(env: Mapping[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


__all__ = [
    "HttpIngestionControlClient",
    "InMemoryIngestionControlClient",
    "IngestionTaskExecutor",
    "PythonAdapterRegistry",
    "build_executor_from_env",
]


if __name__ == "__main__":
    raise SystemExit(main())
