from __future__ import annotations

import argparse
import base64
import gzip
import json
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path

DEFAULT_COLLECTOR_IMAGE = "otel/opentelemetry-collector-contrib:0.127.0"
DEFAULT_FAKE_SINK_IMAGE = "python:3.12-alpine"
DEFAULT_AUTH_HEADER = "Basic local-langfuse-proof"
DEFAULT_INGESTION_VERSION = "4"
REPO_ROOT = Path(__file__).resolve().parents[1]
STAGING_COLLECTOR_TEMPLATE = REPO_ROOT / "infra/otel/collector-staging-template.yaml"
FAKE_SINK_CONTAINER_PORT = 18080
REQUIRED_LANGFUSE_RUNTIME_ATTRIBUTE_TOKENS = (
    b"langfuse.trace.name",
    b"online-answer",
    b"langfuse.session.id",
    b"conv-langfuse-proof",
    b"request_id",
    b"req-langfuse-proof",
    b"run_id",
    b"run-langfuse-proof",
    b"workflow_id",
    b"campus-agent.chat.run-langfuse-proof",
    b"trace_id",
    b"trace-langfuse-proof",
)


@dataclass(frozen=True, slots=True)
class CapturedOtlpRequest:
    path: str
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True, slots=True)
class LangfuseOtlpEvidence:
    path: str
    authorization: str
    ingestion_version: str
    decoded_body_size: int


def build_staging_collector_env(
    *,
    fake_base_url: str,
    langfuse_auth_header: str,
    langfuse_ingestion_version: str,
) -> dict[str, str]:
    return {
        "DEPLOYMENT_ENVIRONMENT": "local-langfuse-proof",
        "OTEL_COLLECTOR_AXIOM_AUTH_HEADER": "Bearer local-axiom-proof",
        "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET": "campus-agent-runtime",
        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT": f"{fake_base_url}/axiom",
        "OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT": "0.0.0.0:13133",
        "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER": langfuse_auth_header,
        "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION": langfuse_ingestion_version,
        "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT": f"{fake_base_url}/api/public/otel",
        "OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE": "100",
        "OTEL_COLLECTOR_MEMORY_LIMIT_MIB": "512",
        "OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB": "128",
        "OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT": "0.0.0.0:4317",
        "OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT": "0.0.0.0:4318",
        "OTEL_COLLECTOR_SENTRY_AUTH_VALUE": "sentry sentry_key=local-proof",
        "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT": f"{fake_base_url}/sentry",
        "OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE": "100",
    }


def build_minimal_otlp_trace_request(
    *,
    trace_id_hex: str = "11111111111111111111111111111111",
    span_id_hex: str = "2222222222222222",
) -> bytes:
    trace_id = _decode_hex_id(trace_id_hex, expected_bytes=16, name="trace_id_hex")
    span_id = _decode_hex_id(span_id_hex, expected_bytes=8, name="span_id_hex")
    start_time = 1_700_000_000_000_000_000
    end_time = start_time + 1_000_000

    span = b"".join(
        (
            _bytes_field(1, trace_id),
            _bytes_field(2, span_id),
            _string_field(5, "runtime-otel-langfuse-fanout-proof"),
            _varint_field(6, 1),
            _fixed64_field(7, start_time),
            _fixed64_field(8, end_time),
            _span_attributes(),
        )
    )
    scope = _string_field(1, "campus-agent-proof")
    scope_spans = _message_field(1, scope) + _message_field(2, span)
    resource = _message_field(
        1,
        _string_field(1, "service.name")
        + _message_field(2, _string_field(1, "campus-agent-langfuse-proof")),
    )
    resource_spans = _message_field(1, resource) + _message_field(2, scope_spans)
    return _message_field(1, resource_spans)


def assert_langfuse_otlp_request(
    request: CapturedOtlpRequest,
    *,
    expected_auth_header: str,
    expected_ingestion_version: str,
) -> LangfuseOtlpEvidence:
    headers = {key.lower(): value for key, value in request.headers.items()}
    if not request.path.startswith("/api/public/otel/"):
        raise AssertionError(
            f"Langfuse OTLP path must start with /api/public/otel/: {request.path}"
        )
    if not request.path.endswith("/v1/traces"):
        raise AssertionError(f"Langfuse OTLP path must end with /v1/traces: {request.path}")

    authorization = str(headers.get("authorization") or "")
    if authorization != expected_auth_header:
        raise AssertionError("Langfuse OTLP authorization header mismatch")

    ingestion_version = str(headers.get("x-langfuse-ingestion-version") or "")
    if ingestion_version != expected_ingestion_version:
        raise AssertionError("Langfuse OTLP ingestion version header mismatch")

    decoded_body = _decode_body(headers, request.body)
    if not decoded_body:
        raise AssertionError("Langfuse OTLP protobuf body is empty")
    missing = [
        token.decode("ascii")
        for token in REQUIRED_LANGFUSE_RUNTIME_ATTRIBUTE_TOKENS
        if token not in decoded_body
    ]
    if missing:
        raise AssertionError(f"missing Langfuse runtime attribute tokens: {missing}")

    return LangfuseOtlpEvidence(
        path=request.path,
        authorization=authorization,
        ingestion_version=ingestion_version,
        decoded_body_size=len(decoded_body),
    )


def run_fanout_proof(
    *,
    collector_image: str,
    fake_sink_image: str = DEFAULT_FAKE_SINK_IMAGE,
    timeout_seconds: float,
) -> LangfuseOtlpEvidence:
    if shutil.which("docker") is None:
        raise RuntimeError("docker is required for the Langfuse fan-out proof")
    if not STAGING_COLLECTOR_TEMPLATE.exists():
        raise RuntimeError(f"staging Collector template is missing: {STAGING_COLLECTOR_TEMPLATE}")

    network_name = f"campus-langfuse-proof-{int(time.time() * 1000)}"
    fake_sink_name = f"{network_name}-sink"
    collector_name = f"{network_name}-collector"
    fake_sink_process: subprocess.Popen[str] | None = None
    collector_process: subprocess.Popen[str] | None = None
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            capture_dir = temp_path / "capture"
            capture_dir.mkdir()
            server_path = temp_path / "fake_sink_server.py"
            server_path.write_text(_fake_sink_server_source(), encoding="utf-8")

            _run_checked(["docker", "network", "create", network_name])
            fake_sink_process = subprocess.Popen(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--name",
                    fake_sink_name,
                    "--network",
                    network_name,
                    "-v",
                    f"{server_path}:/fake_sink_server.py:ro",
                    "-v",
                    f"{capture_dir}:/capture",
                    "-e",
                    "FAKE_SINK_OUTPUT_DIR=/capture",
                    fake_sink_image,
                    "python",
                    "/fake_sink_server.py",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            _wait_for_fake_sink_ready(
                capture_dir=capture_dir,
                process=fake_sink_process,
                timeout_seconds=timeout_seconds,
            )

            collector_env = build_staging_collector_env(
                fake_base_url=f"http://{fake_sink_name}:{FAKE_SINK_CONTAINER_PORT}",
                langfuse_auth_header=DEFAULT_AUTH_HEADER,
                langfuse_ingestion_version=DEFAULT_INGESTION_VERSION,
            )
            collector_process = subprocess.Popen(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--name",
                    collector_name,
                    "--network",
                    network_name,
                    "-p",
                    "127.0.0.1::4318",
                    "-p",
                    "127.0.0.1::13133",
                    "-v",
                    f"{STAGING_COLLECTOR_TEMPLATE}:/etc/otelcol-contrib/config.yaml:ro",
                    *[
                        item
                        for key, value in collector_env.items()
                        for item in ("-e", f"{key}={value}")
                    ],
                    collector_image,
                    "--config=/etc/otelcol-contrib/config.yaml",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            otlp_port = _wait_for_docker_port(
                container_name=collector_name,
                container_port=4318,
                process=collector_process,
                timeout_seconds=timeout_seconds,
            )
            health_port = _wait_for_docker_port(
                container_name=collector_name,
                container_port=13133,
                process=collector_process,
                timeout_seconds=timeout_seconds,
            )
            _wait_for_collector_health(
                url=f"http://127.0.0.1:{health_port}/",
                process=collector_process,
                timeout_seconds=timeout_seconds,
            )
            _post_otlp_trace(
                url=f"http://127.0.0.1:{otlp_port}/v1/traces",
                payload=build_minimal_otlp_trace_request(),
                timeout_seconds=timeout_seconds,
            )
            try:
                captured = _wait_for_langfuse_capture(capture_dir, timeout_seconds)
            except TimeoutError as exc:
                collector_stdout, collector_stderr = _terminate_process(collector_process)
                fake_stdout, fake_stderr = _terminate_process(fake_sink_process)
                raise TimeoutError(
                    "fake Langfuse did not receive an OTLP request\n"
                    f"collector stdout:\n{collector_stdout}\ncollector stderr:\n{collector_stderr}\n"
                    f"fake sink stdout:\n{fake_stdout}\nfake sink stderr:\n{fake_stderr}"
                ) from exc
            return assert_langfuse_otlp_request(
                captured,
                expected_auth_header=DEFAULT_AUTH_HEADER,
                expected_ingestion_version=DEFAULT_INGESTION_VERSION,
            )
    finally:
        _run_unchecked(["docker", "rm", "-f", collector_name])
        _run_unchecked(["docker", "rm", "-f", fake_sink_name])
        if collector_process is not None:
            _terminate_process(collector_process)
        if fake_sink_process is not None:
            _terminate_process(fake_sink_process)
        _run_unchecked(["docker", "network", "rm", network_name])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prove the runtime OTel Collector fans traces out to Langfuse OTLP/HTTP.",
    )
    parser.add_argument("--collector-image", default=DEFAULT_COLLECTOR_IMAGE)
    parser.add_argument("--timeout-seconds", type=float, default=60)
    args = parser.parse_args()

    evidence = run_fanout_proof(
        collector_image=str(args.collector_image),
        timeout_seconds=float(args.timeout_seconds),
    )
    print(json.dumps(asdict(evidence), sort_keys=True))
    return 0


def _fake_sink_server_source() -> str:
    return f"""\
from __future__ import annotations

import base64
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUTPUT_DIR = os.environ["FAKE_SINK_OUTPUT_DIR"]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("content-length") or "0")
        body = self.rfile.read(length)
        record = {{
            "body_b64": base64.b64encode(body).decode("ascii"),
            "headers": {{key.lower(): value for key, value in self.headers.items()}},
            "path": self.path,
        }}
        path = os.path.join(OUTPUT_DIR, f"{{time.time_ns()}}.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(record, handle, sort_keys=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{{}}")

    def log_message(self, format: str, *args: object) -> None:
        return


with open(os.path.join(OUTPUT_DIR, "ready"), "w", encoding="utf-8") as handle:
    handle.write("ready")

ThreadingHTTPServer(("0.0.0.0", {FAKE_SINK_CONTAINER_PORT}), Handler).serve_forever()
"""


def _wait_for_fake_sink_ready(
    *,
    capture_dir: Path,
    process: subprocess.Popen[str],
    timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    ready_path = capture_dir / "ready"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            raise RuntimeError(
                f"fake sink exited before becoming ready\nstdout:\n{stdout}\nstderr:\n{stderr}"
            )
        if ready_path.exists():
            return
        time.sleep(0.05)
    raise TimeoutError("fake sink did not become ready")


def _wait_for_langfuse_capture(capture_dir: Path, timeout_seconds: float) -> CapturedOtlpRequest:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        paths = sorted(capture_dir.glob("*.json"))
        for path in paths:
            request = _read_captured_request(path)
            if request.path.startswith("/api/public/otel/"):
                return request
        time.sleep(0.05)
    captured_paths = [
        _read_captured_request(path).path for path in sorted(capture_dir.glob("*.json"))
    ]
    raise TimeoutError(f"fake Langfuse did not receive an OTLP request; captured={captured_paths}")


def _read_captured_request(path: Path) -> CapturedOtlpRequest:
    record = json.loads(path.read_text(encoding="utf-8"))
    return CapturedOtlpRequest(
        path=str(record["path"]),
        headers={str(key): str(value) for key, value in record["headers"].items()},
        body=base64.b64decode(str(record["body_b64"])),
    )


def _run_checked(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True)


def _run_unchecked(command: list[str]) -> None:
    subprocess.run(command, check=False, capture_output=True, text=True)


def _post_otlp_trace(*, url: str, payload: bytes, timeout_seconds: float) -> None:
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"content-type": "application/x-protobuf"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"Collector rejected OTLP trace with status {response.status}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Collector rejected OTLP trace with status {exc.code}: {body}") from exc


def _wait_for_collector_health(
    *,
    url: str,
    process: subprocess.Popen[str],
    timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            raise RuntimeError(
                f"Collector exited before becoming healthy\nstdout:\n{stdout}\nstderr:\n{stderr}"
            )
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (ConnectionError, TimeoutError, urllib.error.URLError):
            time.sleep(0.2)
    stdout, stderr = process.communicate(timeout=1) if process.poll() is not None else ("", "")
    raise TimeoutError(
        f"Collector health endpoint did not become ready\nstdout:\n{stdout}\nstderr:\n{stderr}"
    )


def _wait_for_docker_port(
    *,
    container_name: str,
    container_port: int,
    process: subprocess.Popen[str],
    timeout_seconds: float,
) -> int:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            raise RuntimeError(
                f"Collector exited before publishing ports\nstdout:\n{stdout}\nstderr:\n{stderr}"
            )
        result = subprocess.run(
            ["docker", "port", container_name, f"{container_port}/tcp"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            line = result.stdout.strip().splitlines()[0]
            return int(line.rsplit(":", 1)[1])
        time.sleep(0.2)
    raise TimeoutError(f"Collector port {container_port}/tcp was not published")


def _terminate_process(process: subprocess.Popen[str]) -> tuple[str, str]:
    if process.poll() is not None:
        return process.communicate(timeout=1)
    process.terminate()
    try:
        return process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        return process.communicate(timeout=5)


def _decode_body(headers: Mapping[str, str], body: bytes) -> bytes:
    encoding = str(headers.get("content-encoding") or "").lower()
    if encoding == "gzip":
        return gzip.decompress(body)
    return body


def _decode_hex_id(value: str, *, expected_bytes: int, name: str) -> bytes:
    try:
        decoded = bytes.fromhex(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be hex") from exc
    if len(decoded) != expected_bytes:
        raise ValueError(f"{name} must be {expected_bytes * 2} hex characters")
    return decoded


def _span_attributes() -> bytes:
    attributes = (
        ("langfuse.trace.name", "online-answer"),
        ("langfuse.session.id", "conv-langfuse-proof"),
        ("langfuse.user.id", "user-langfuse-proof"),
        ("langfuse.release", "execution-control@langfuse-proof"),
        ("langfuse.trace.tags", "surface:execution-control,capability:knowledge,env:local"),
        ("request_id", "req-langfuse-proof"),
        ("run_id", "run-langfuse-proof"),
        ("workflow_id", "campus-agent.chat.run-langfuse-proof"),
        ("trace_id", "trace-langfuse-proof"),
    )
    return b"".join(_message_field(9, _key_value_string(key, value)) for key, value in attributes)


def _key_value_string(key: str, value: str) -> bytes:
    return _string_field(1, key) + _message_field(2, _string_field(1, value))


def _message_field(field_number: int, payload: bytes) -> bytes:
    return _bytes_field(field_number, payload)


def _string_field(field_number: int, value: str) -> bytes:
    return _bytes_field(field_number, value.encode("utf-8"))


def _bytes_field(field_number: int, value: bytes) -> bytes:
    return _varint((field_number << 3) | 2) + _varint(len(value)) + value


def _varint_field(field_number: int, value: int) -> bytes:
    return _varint(field_number << 3) + _varint(value)


def _fixed64_field(field_number: int, value: int) -> bytes:
    if value < 0:
        raise ValueError("fixed64 value must be non-negative")
    return _varint((field_number << 3) | 1) + value.to_bytes(8, byteorder="little")


def _varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varint value must be non-negative")
    encoded = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            encoded.append(byte | 0x80)
        else:
            encoded.append(byte)
            return bytes(encoded)


if __name__ == "__main__":
    raise SystemExit(main())
