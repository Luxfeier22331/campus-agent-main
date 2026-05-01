from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from urllib import error as url_error
from urllib import request as url_request


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    local_run_id = f"owrun_consumer_live_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    output_root = repo_root / args.output_root / local_run_id
    output_root.mkdir(parents=True, exist_ok=True)

    preflight_ports(args.app_api_port, args.handoff_port)
    collector_env = {
        **os.environ,
        **load_env_file(repo_root / ".env"),
        **load_env_file(repo_root / "apps" / "official-web-collector" / ".env"),
    }
    app_env_files = {
        **load_env_file(repo_root / "apps" / "app-api" / ".env"),
        **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
    }
    assert_collector_token_ready(app_env_files, collector_env)

    handoff_token = secrets.token_hex(32)
    handoff_url = f"http://127.0.0.1:{args.handoff_port}/api/official-web/handoffs"
    processes: list[subprocess.Popen[bytes]] = []
    try:
        processes.append(
            start_process(
                repo_root,
                (
                    "uv",
                    "run",
                    "--all-packages",
                    "campus-ingestion-official-web-handoff-dev",
                ),
                env={
                    "INGESTION_WORKER_HTTP_HOST": "127.0.0.1",
                    "INGESTION_WORKER_HTTP_PORT": str(args.handoff_port),
                    "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR": str(
                        output_root / "handoffs"
                    ),
                    "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_TOKEN": handoff_token,
                },
                log_path=output_root / "handoff-receiver.log",
            )
        )
        processes.append(
            start_process(
                repo_root,
                ("pnpm", "--dir", "apps/app-api", "dev"),
                env={
                    "APP_API_OFFICIAL_WEB_HANDOFF_URL": handoff_url,
                    "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN": handoff_token,
                    "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS": "8000",
                },
                log_path=output_root / "app-api.log",
            )
        )
        wait_for_json(f"http://127.0.0.1:{args.handoff_port}/readyz")
        wait_for_json(f"http://127.0.0.1:{args.app_api_port}/healthz")

        collector_result = run_json_command(
            repo_root,
            (
                "pnpm",
                "--dir",
                "apps/official-web-collector",
                "crawl",
                "--",
                "--site-id",
                args.site_id,
                "--run-intent",
                "hot",
                "--trigger-type",
                "manual",
                "--host",
                args.host,
                "--max-pages-per-host",
                str(args.max_pages_per_host),
                "--max-total-pages",
                str(args.max_total_pages),
                "--crawl-run-id",
                local_run_id,
                "--scheduler-run-key",
                f"manual-consumer-live-{local_run_id}",
                "--trace-id",
                f"trace-{local_run_id}",
                "--output-dir",
                str(output_root / "collector-output"),
            ),
            env=collector_env,
            log_path=output_root / "collector.log",
        )
        actual_run_id = str(collector_result["crawlRun"]["crawlRunId"])

        drain_result = run_json_command(
            repo_root,
            (
                "pnpm",
                "--dir",
                "apps/app-api",
                "official-web:drain-projection",
                "--",
                "--limit",
                "5",
            ),
            env={
                "APP_API_OFFICIAL_WEB_HANDOFF_URL": handoff_url,
                "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN": handoff_token,
                "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS": "8000",
            },
            log_path=output_root / "drain.log",
        )
        handoff_path = handoff_path_for_run(output_root / "handoffs", actual_run_id)
        event_id = handoff_path.stem
        internal_secret = app_env_files.get("APP_API_INTERNAL_SHARED_SECRET", "")

        consumer_result = run_json_command(
            repo_root,
            (
                "uv",
                "run",
                "--all-packages",
                "campus-ingestion-consume-official-web-handoffs",
                "--event-id",
                event_id,
                "--limit",
                "1",
                "--force",
            ),
            env={
                **load_env_file(repo_root / ".env"),
                "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR": str(output_root / "handoffs"),
                "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_EXECUTION_ROOT_DIR": str(
                    output_root / "executions"
                ),
                "INGESTION_WORKER_OFFICIAL_WEB_PROMOTE_IMPORT": "false",
                "INGESTION_WORKER_APP_API_BASE_URL": f"http://127.0.0.1:{args.app_api_port}",
                "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET": internal_secret,
            },
            log_path=output_root / "consumer.log",
        )
        execution_report_path = Path(
            consumer_result["results"][0]["execution_report_path"]
        ).resolve()
        execution_report = json.loads(execution_report_path.read_text(encoding="utf-8"))
        db_run = query_app_api_run(repo_root, actual_run_id, output_root=output_root)
        seam_report = build_seam_report(
            actual_run_id=actual_run_id,
            collector_result=collector_result,
            consumer_result=consumer_result,
            db_run=db_run,
            drain_result=drain_result,
            event_id=event_id,
            execution_report=execution_report,
            execution_report_path=execution_report_path,
            local_run_id=local_run_id,
            output_root=output_root,
        )
        assert_seam_report(seam_report)
        write_json(output_root / "seam-report.json", seam_report)
        print(json.dumps(seam_report, ensure_ascii=False, indent=2))
    finally:
        terminate_processes(processes)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run official_web no-promotion live seam.")
    parser.add_argument("--site-id", default="muc_public")
    parser.add_argument("--host", default="xxgk.muc.edu.cn")
    parser.add_argument("--max-pages-per-host", type=int, default=6)
    parser.add_argument("--max-total-pages", type=int, default=6)
    parser.add_argument("--app-api-port", type=int, default=8787)
    parser.add_argument("--handoff-port", type=int, default=8789)
    parser.add_argument("--output-root", type=Path, default=Path("var/official-web-live-seam"))
    return parser


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def assert_collector_token_ready(
    app_env: Mapping[str, str],
    collector_env: Mapping[str, str],
) -> None:
    app_token = app_env.get("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", "")
    collector_token = collector_env.get("OFFICIAL_WEB_SERVICE_TOKEN", "")
    if not app_token or not collector_token:
        raise RuntimeError("official_web collector token is not configured for local seam")
    if app_token != collector_token:
        raise RuntimeError("official_web collector token does not match app-api token")


def preflight_ports(*ports: int) -> None:
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"port {port} is already in use")


def start_process(
    repo_root: Path,
    command: tuple[str, ...],
    *,
    env: Mapping[str, str],
    log_path: Path,
) -> subprocess.Popen[bytes]:
    merged_env = {**os.environ, **dict(env)}
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_file = log_path.open("wb")
    process = subprocess.Popen(
        command,
        cwd=repo_root,
        env=merged_env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    time.sleep(0.2)
    if process.poll() is not None:
        log_file.close()
        raise RuntimeError(f"process exited early: {' '.join(command)}")
    return process


def run_json_command(
    repo_root: Path,
    command: tuple[str, ...],
    *,
    env: Mapping[str, str],
    log_path: Path,
) -> dict[str, object]:
    merged_env = {**os.environ, **dict(env)}
    result = subprocess.run(
        command,
        cwd=repo_root,
        env=merged_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    log_path.write_bytes(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(command)}")
    return extract_last_json_object(result.stdout.decode("utf-8", errors="replace"))


def extract_last_json_object(output: str) -> dict[str, object]:
    decoder = json.JSONDecoder()
    last: dict[str, object] | None = None
    for index, char in enumerate(output):
        if char != "{":
            continue
        try:
            payload, end_index = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            if not output[index + end_index :].strip():
                return payload
            last = payload
    if last is None:
        raise RuntimeError("command did not emit a JSON object")
    return last


def wait_for_json(url: str, *, timeout_seconds: float = 120.0) -> dict[str, object]:
    deadline = time.monotonic() + timeout_seconds
    last_error: object = None
    while time.monotonic() < deadline:
        try:
            with url_request.urlopen(url, timeout=2.0) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict):
                    return payload
        except (url_error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}: {last_error}")


def handoff_path_for_run(inbox_dir: Path, run_id: str) -> Path:
    matched_paths: list[Path] = []
    for path in sorted(inbox_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        event_payload = payload.get("payload")
        if not isinstance(event_payload, dict):
            continue
        if event_payload.get("runId") == run_id:
            matched_paths.append(path)
    if len(matched_paths) != 1:
        raise RuntimeError(
            f"expected exactly one handoff record for {run_id}, found {len(matched_paths)}"
        )
    return matched_paths[0]


def query_app_api_run(repo_root: Path, run_id: str, *, output_root: Path) -> dict[str, object]:
    code = """
(async () => {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB,
  });
  await client.connect();
  const result = await client.query(
    'select status, ingestion_dispatch_status, ingestion_execution_status, ingestion_execution_error_code from official_web.crawl_runs where run_id=$1',
    [process.argv.at(-1)],
  );
  await client.end();
  console.log(JSON.stringify(result.rows[0] || null));
})().catch((error) => {
  console.log(JSON.stringify({ error: String(error.message || error) }));
  process.exit(1);
});
""".strip()
    return run_json_command(
        repo_root,
        ("pnpm", "--dir", "apps/app-api", "exec", "node", "-e", code, run_id),
        env=load_env_file(repo_root / "apps" / "app-api" / ".env"),
        log_path=output_root / "app-api-query.log",
    )


def build_seam_report(
    *,
    actual_run_id: str,
    collector_result: dict[str, object],
    consumer_result: dict[str, object],
    db_run: dict[str, object],
    drain_result: dict[str, object],
    event_id: str,
    execution_report: dict[str, object],
    execution_report_path: Path,
    local_run_id: str,
    output_root: Path,
) -> dict[str, object]:
    crawl_run = collector_result["crawlRun"]
    assert isinstance(crawl_run, dict)
    counters = crawl_run.get("counters")
    assert isinstance(counters, dict)
    denominator = counters.get("consumerDenominator")
    assert isinstance(denominator, dict)
    source_bundle = next(
        artifact
        for artifact in collector_result["uploadedArtifacts"]
        if artifact["artifactType"] == "source_truth_bundle"
    )
    return {
        "schema_version": "official_web_no_promotion_live_seam.v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "local_run_id": local_run_id,
        "actual_run_id": actual_run_id,
        "event_id": event_id,
        "output_root": str(output_root.resolve()),
        "collector": {
            "status": crawl_run.get("status"),
            "retained_source_truth_pages": denominator.get("retainedSourceTruthPages"),
            "source_truth_bundle_record_count": source_bundle.get("recordCount"),
            "source_truth_bundle_object_key": source_bundle.get("objectKey"),
        },
        "app_api": {
            "drain": drain_result,
            "db_run": db_run,
        },
        "consumer": {
            "counts": consumer_result.get("counts"),
            "execution_report_path": str(execution_report_path),
            "status": execution_report.get("status"),
            "promotion_decision": (execution_report.get("promotion") or {}).get("decision"),
            "import_is_null": execution_report.get("import") is None,
            "error_is_null": execution_report.get("error") is None,
            "candidate_count": (
                (execution_report.get("consumerCandidateReview") or {})
                .get("counts", {})
                .get("candidate_count")
            ),
        },
    }


def assert_seam_report(report: dict[str, object]) -> None:
    collector = report["collector"]
    app_api = report["app_api"]
    consumer = report["consumer"]
    assert isinstance(collector, dict)
    assert isinstance(app_api, dict)
    assert isinstance(consumer, dict)
    db_run = app_api["db_run"]
    assert isinstance(db_run, dict)
    if collector.get("status") != "completed":
        raise RuntimeError("collector did not complete")
    if int(collector.get("retained_source_truth_pages") or 0) < 1:
        raise RuntimeError("collector retained no source-truth pages")
    if consumer.get("status") != "staged":
        raise RuntimeError("consumer did not stage execution")
    if consumer.get("promotion_decision") != "staged":
        raise RuntimeError("promotion decision was not staged")
    if consumer.get("import_is_null") is not True or consumer.get("error_is_null") is not True:
        raise RuntimeError("consumer imported or errored during no-promotion seam")
    if db_run.get("ingestion_dispatch_status") != "dispatched":
        raise RuntimeError("app-api dispatch status was not dispatched")
    if db_run.get("ingestion_execution_status") != "staged":
        raise RuntimeError("app-api execution status was not staged")
    if db_run.get("ingestion_execution_error_code") is not None:
        raise RuntimeError("app-api execution status has an error")


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def terminate_processes(processes: Sequence[subprocess.Popen[bytes]]) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    deadline = time.monotonic() + 10
    for process in reversed(processes):
        while process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.2)
        if process.poll() is None:
            process.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"official_web live seam failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
