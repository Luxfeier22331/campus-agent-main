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
from urllib.parse import urlparse

from scripts.official_web_live_seam_report import assert_seam_report, build_seam_report


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    args = resolve_inventory_target_args(repo_root, args)
    local_run_id = f"owrun_consumer_live_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    output_root = repo_root / args.output_root / local_run_id
    output_root.mkdir(parents=True, exist_ok=True)

    preflight_ports(args.app_api_port, args.handoff_port)
    collector_env = build_collector_env(repo_root, app_api_port=args.app_api_port)
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
                build_app_api_dev_command(args.app_api_port),
                env=build_app_api_dev_env(
                    repo_root,
                    handoff_url=handoff_url,
                    handoff_token=handoff_token,
                ),
                log_path=output_root / "app-api.log",
            )
        )
        wait_for_json(f"http://127.0.0.1:{args.handoff_port}/readyz")
        wait_for_json(f"http://127.0.0.1:{args.app_api_port}/healthz")

        target_seed = seed_target_workset(repo_root, args, output_root=output_root)
        collector_result = run_json_command(
            repo_root,
            build_collector_command(
                args=args,
                local_run_id=local_run_id,
                output_root=output_root,
                target_seed=target_seed,
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
            target_seed=target_seed,
        )
        assert_seam_report(seam_report)
        write_json(output_root / "seam-report.json", seam_report)
        print(json.dumps(seam_report, ensure_ascii=False, indent=2))
    finally:
        terminate_processes(processes)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run official_web no-promotion live seam.")
    parser.add_argument("--site-id", default="muc_public")
    parser.add_argument("--inventory-id", default="")
    parser.add_argument("--host", default="xxgk.muc.edu.cn")
    parser.add_argument("--target-id", default="campus-services-service-guide")
    parser.add_argument("--target-url", default="https://xxgk.muc.edu.cn/info/1007/1113.htm")
    parser.add_argument("--max-pages-per-host", type=int, default=6)
    parser.add_argument("--max-total-pages", type=int, default=6)
    parser.add_argument("--app-api-port", type=int, default=27031)
    parser.add_argument("--handoff-port", type=int, default=27041)
    parser.add_argument("--output-root", type=Path, default=Path("var/official-web-live-seam"))
    return parser


def resolve_inventory_target_args(
    repo_root: Path,
    args: argparse.Namespace,
) -> argparse.Namespace:
    inventory_id = str(getattr(args, "inventory_id", "") or "").strip()
    if not inventory_id:
        return args

    inventory_path = (
        repo_root
        / "configs"
        / "sources"
        / "official_web"
        / str(args.site_id)
        / "target-inventory.json"
    )
    payload = json.loads(inventory_path.read_text(encoding="utf-8"))
    entries = payload.get("entries", [])
    if not isinstance(entries, list):
        raise RuntimeError(f"{inventory_path} entries must be a list")

    matched = [
        entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("inventory_id") == inventory_id
    ]
    if len(matched) != 1:
        raise RuntimeError(
            f"expected exactly one inventory entry {inventory_id} in {inventory_path}, found {len(matched)}"
        )

    entry = matched[0]
    source_urls = entry.get("source_urls", [])
    if not isinstance(source_urls, list) or not source_urls:
        raise RuntimeError(f"inventory entry {inventory_id} must define source_urls")
    target_url = str(source_urls[0])
    parsed_url = urlparse(target_url)
    host = (parsed_url.hostname or "").lower()
    if not host:
        raise RuntimeError(f"inventory entry {inventory_id} source URL must include a host")

    args.target_id = str(entry.get("admission_target_id") or "")
    args.target_url = target_url
    args.host = host
    return args


def seed_target_workset(
    repo_root: Path,
    args: argparse.Namespace,
    *,
    output_root: Path,
) -> dict[str, object]:
    parsed_url = urlparse(str(args.target_url))
    target_host = (parsed_url.hostname or "").lower()
    if not target_host:
        raise RuntimeError("--target-url must include a valid host")
    if target_host != str(args.host).lower():
        raise RuntimeError("--host must match --target-url host for a target-workset seam")

    code = r"""
(async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { Client } = await import('pg');

  const [siteId, targetId, targetUrl] = process.argv.slice(-3);
  const configPath = resolve(
    process.cwd(),
    '..',
    '..',
    'configs',
    'sources',
    'official_web',
    siteId,
    'target-source-map.json',
  );
  const targetMap = JSON.parse(readFileSync(configPath, 'utf8'));
  const target = targetMap.targets.find((item) => item.target_id === targetId);
  if (!target) {
    throw new Error(`target ${targetId} is not declared in ${configPath}`);
  }
  const sourceHost = new URL(targetUrl).hostname.toLowerCase();
  if (!target.source_hosts.includes(sourceHost)) {
    throw new Error(`target ${targetId} does not admit host ${sourceHost}`);
  }
  const jobId = `owtarget_${siteId}_${targetId}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const candidateId = `owcand_${createHash('sha256')
    .update(`${siteId}:${targetMap.map_version}:${targetId}:${targetUrl}`)
    .digest('hex')
    .slice(0, 24)}`;
  const now = new Date().toISOString();
  const idempotencyKey = `${siteId}:${targetMap.map_version}:${targetId}`;
  let previewRequeuedFreshnessRows = 0;

  const client = new Client({
    connectionString: process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB,
  });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `
        insert into official_web.target_jobs (
          job_id, site_id, target_id, declaration_version, idempotency_key, status,
          consumer_family, owner_surface, selected_write_target, source_hosts_json,
          url_hints_json, title_hints_json, required_evidence_json, retention_policy,
          review_policy, materialization_policy, inventory_only, latest_run_id,
          candidate_count, attempt_count, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, 'declared',
          $6, $7, $8, $9::jsonb,
          $10::jsonb, $11::jsonb, $12::jsonb, $13,
          $14, $15, $16, null,
          0, 0, $17, $17
        )
        on conflict (idempotency_key) do update set
          consumer_family = excluded.consumer_family,
          inventory_only = excluded.inventory_only,
          materialization_policy = excluded.materialization_policy,
          owner_surface = excluded.owner_surface,
          required_evidence_json = excluded.required_evidence_json,
          retention_policy = excluded.retention_policy,
          review_policy = excluded.review_policy,
          selected_write_target = excluded.selected_write_target,
          source_hosts_json = excluded.source_hosts_json,
          status = case
            when official_web.target_jobs.status = 'active' then official_web.target_jobs.status
            else excluded.status
          end,
          title_hints_json = excluded.title_hints_json,
          updated_at = excluded.updated_at,
          url_hints_json = excluded.url_hints_json
      `,
      [
        jobId,
        siteId,
        targetId,
        targetMap.map_version,
        idempotencyKey,
        target.consumer_family,
        target.owner_surface,
        target.selected_write_target,
        JSON.stringify(target.source_hosts),
        JSON.stringify(target.url_hints),
        JSON.stringify(target.title_hints),
        JSON.stringify(target.required_evidence),
        target.retention_policy,
        target.review_policy,
        target.materialization_policy,
        Boolean(target.inventory_only),
        now,
      ],
    );
    await client.query(
      `
        insert into official_web.target_job_candidates (
          candidate_id, job_id, site_id, target_id, normalized_candidate_url,
          source_host, eligibility_reason, url_hint, title_hint, status,
          priority_score, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5,
          $6, 'manual_live_seam_seed', $7, $8, 'eligible',
          2147483647, $9, $9
        )
        on conflict (candidate_id) do update set
          eligibility_reason = excluded.eligibility_reason,
          normalized_candidate_url = excluded.normalized_candidate_url,
          priority_score = excluded.priority_score,
          source_host = excluded.source_host,
          status = excluded.status,
          title_hint = excluded.title_hint,
          updated_at = excluded.updated_at,
          url_hint = excluded.url_hint
      `,
      [
        candidateId,
        jobId,
        siteId,
        targetId,
        targetUrl,
        sourceHost,
        target.url_hints[0] || null,
        target.title_hints[0] || null,
        now,
      ],
    );
    const previewRequeueResult = await client.query(
      `
        update official_web.page_freshness
        set
          last_change_reason = 'manual_live_seam_preview_requeue',
          next_eligible_fetch_at = $3,
          updated_at = $3
        where site_id = $1
          and normalized_canonical_url = $2
          and next_eligible_fetch_at > $3
      `,
      [siteId, targetUrl, now],
    );
    previewRequeuedFreshnessRows = previewRequeueResult.rowCount;
    await client.query(
      `
        update official_web.target_jobs
        set
          candidate_count = (
            select count(*)::int
            from official_web.target_job_candidates
            where job_id = $1
          ),
          updated_at = $2
        where job_id = $1
      `,
      [jobId, now],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    declarationVersion: targetMap.map_version,
    sourceHost,
    targetCandidateId: candidateId,
    targetId,
    targetJobId: jobId,
    targetUrl,
    previewRequeuedFreshnessRows,
  }));
})().catch((error) => {
  console.log(JSON.stringify({ error: String(error.message || error) }));
  process.exit(1);
});
""".strip()
    return run_json_command(
        repo_root,
        (
            "pnpm",
            "--dir",
            "apps/app-api",
            "exec",
            "node",
            "-e",
            code,
            str(args.site_id),
            str(args.target_id),
            str(args.target_url),
        ),
        env={
            **load_env_file(repo_root / "apps" / "app-api" / ".env"),
            **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
        },
        log_path=output_root / "target-seed.log",
    )


def build_collector_command(
    *,
    args: argparse.Namespace,
    local_run_id: str,
    output_root: Path,
    target_seed: Mapping[str, object],
) -> tuple[str, ...]:
    command: list[str] = [
        "pnpm",
        "--dir",
        "apps/official-web-collector",
        "crawl",
        "--",
        "--site-id",
        str(args.site_id),
        "--run-intent",
        "hot",
        "--trigger-type",
        "manual",
        "--host",
        str(args.host),
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
        "--disable-conditional-headers",
        "--output-dir",
        str(output_root / "collector-output"),
    ]
    target_candidate_id = str(target_seed.get("targetCandidateId") or "").strip()
    if target_candidate_id:
        command.extend(("--target-candidate-id", target_candidate_id))
    return tuple(command)


def build_collector_env(
    repo_root: Path,
    *,
    app_api_port: int,
) -> dict[str, str]:
    return {
        **os.environ,
        **load_env_file(repo_root / ".env"),
        **load_env_file(repo_root / "apps" / "official-web-collector" / ".env"),
        "OFFICIAL_WEB_APP_API_BASE_URL": f"http://127.0.0.1:{app_api_port}",
    }


def build_app_api_dev_command(app_api_port: int) -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/app-api",
        "exec",
        "wrangler",
        "dev",
        "-e",
        "local",
        "--ip",
        "127.0.0.1",
        "--port",
        str(app_api_port),
    )


def build_app_api_dev_env(
    repo_root: Path,
    *,
    handoff_url: str,
    handoff_token: str,
) -> dict[str, str]:
    return {
        **load_env_file(repo_root / "apps" / "app-api" / ".env"),
        **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
        "APP_API_OFFICIAL_WEB_HANDOFF_URL": handoff_url,
        "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN": handoff_token,
        "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS": "8000",
        "WRANGLER_DISABLE_EXPERIMENTAL_WARNING": "1",
        "XDG_CONFIG_HOME": "./.wrangler-home",
    }


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
  if (!result.rows[0]) {
    await client.end();
    console.log(JSON.stringify({ error: 'run_not_found' }));
    return;
  }
  const attemptResult = await client.query(
    `
      select
        count(*)::int as target_attempt_count,
        coalesce(
          array_agg(distinct job_id) filter (where job_id is not null),
          ARRAY[]::text[]
        ) as target_job_ids,
        coalesce(
          json_agg(
            json_build_object(
              'attemptId', attempt_id,
              'attemptStatus', attempt_status,
              'candidateId', candidate_id,
              'httpStatus', http_status,
              'jobId', job_id,
              'normalizedCanonicalUrl', normalized_canonical_url,
              'targetId', target_id
            )
            order by attempted_at
          ) filter (where attempt_id is not null),
          '[]'::json
        ) as target_attempts
      from official_web.target_page_attempts
      where run_id=$1
    `,
    [process.argv.at(-1)],
  );
  const attemptRow = attemptResult.rows[0] || {
    target_attempt_count: 0,
    target_attempts: [],
    target_job_ids: [],
  };
  const targetJobIds = attemptRow.target_job_ids || [];
  const jobResult = targetJobIds.length
    ? await client.query(
        `
          select
            job_id,
            target_id,
            status,
            latest_run_id,
            candidate_count,
            attempt_count
          from official_web.target_jobs
          where job_id = any($1::text[])
          order by job_id
        `,
        [targetJobIds],
      )
    : { rows: [] };
  await client.end();
  console.log(JSON.stringify({
    ...result.rows[0],
    target_attempt_count: attemptRow.target_attempt_count,
    target_attempts: attemptRow.target_attempts || [],
    target_job_ids: targetJobIds,
    target_jobs: jobResult.rows,
  }));
})().catch((error) => {
  console.log(JSON.stringify({ error: String(error.message || error) }));
  process.exit(1);
});
""".strip()
    return run_json_command(
        repo_root,
        ("pnpm", "--dir", "apps/app-api", "exec", "node", "-e", code, run_id),
        env={
            **load_env_file(repo_root / "apps" / "app-api" / ".env"),
            **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
        },
        log_path=output_root / "app-api-query.log",
    )


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
