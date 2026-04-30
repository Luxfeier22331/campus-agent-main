from __future__ import annotations

import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request


def wait_for_status(
    url: str,
    *,
    expected_statuses: set[int],
    timeout_seconds: float,
    headers: dict[str, str] | None = None,
) -> int:
    deadline = time.monotonic() + timeout_seconds
    last_status = 0
    while time.monotonic() < deadline:
        last_status = _request_status(url, headers=headers)
        if last_status in expected_statuses:
            return last_status
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}; last_status={last_status}")


def wait_for_json_status(
    url: str,
    *,
    expected_statuses: set[int],
    timeout_seconds: float,
) -> tuple[int, object]:
    deadline = time.monotonic() + timeout_seconds
    last_response: tuple[int, object] = (0, {})
    while time.monotonic() < deadline:
        last_response = _request_json(url)
        if last_response[0] in expected_statuses:
            return last_response
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}; last_status={last_response[0]}")


def post_answer_probe(
    url: str,
    payload: dict[str, object],
    *,
    response_kind: str,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, object]:
    if response_kind == "sse":
        return _post_sse(url, payload, headers=headers, timeout_seconds=timeout_seconds)
    if response_kind == "json":
        return _post_json(url, payload, headers=headers, timeout_seconds=timeout_seconds)
    raise ValueError(f"unsupported answer response kind: {response_kind}")


def terminate_processes(processes: list[subprocess.Popen[bytes]]) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            _signal_process_group(process, signal.SIGTERM)
    deadline = time.monotonic() + 8
    for process in reversed(processes):
        remaining = max(0.1, deadline - time.monotonic())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            _signal_process_group(process, signal.SIGKILL)
            process.wait(timeout=2)


def _request_status(url: str, *, headers: dict[str, str] | None = None) -> int:
    try:
        request = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(request, timeout=2) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except OSError:
        return 0


def _request_json(url: str) -> tuple[int, object]:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return int(response.status), json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def _post_json(
    url: str,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return int(response.status), json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def _post_sse(
    url: str,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return int(response.status), _parse_sse_response(response.read())
    except urllib.error.HTTPError as exc:
        return int(exc.code), _parse_sse_response(exc.read())


def _parse_sse_response(raw_body: bytes) -> dict[str, object]:
    body_text = raw_body.decode("utf-8", errors="replace")
    events: list[dict[str, object]] = []
    event_name = "message"
    data_lines: list[str] = []
    for line in body_text.splitlines():
        if line == "":
            if data_lines:
                events.append(_sse_event(event_name, "\n".join(data_lines)))
            event_name = "message"
            data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line.removeprefix("event:").strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line.removeprefix("data:").strip())
    if data_lines:
        events.append(_sse_event(event_name, "\n".join(data_lines)))
    return {
        "kind": "sse",
        "body_text": body_text,
        "events": events,
    }


def _sse_event(event_name: str, data_text: str) -> dict[str, object]:
    try:
        data: object = json.loads(data_text)
    except json.JSONDecodeError:
        data = data_text
    return {
        "event": event_name,
        "data": data,
    }


def _signal_process_group(process: subprocess.Popen[bytes], sig: signal.Signals) -> None:
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        return
    except OSError:
        try:
            process.send_signal(sig)
        except ProcessLookupError:
            return


__all__ = [
    "post_answer_probe",
    "terminate_processes",
    "wait_for_json_status",
    "wait_for_status",
]
