from __future__ import annotations

import argparse
import json
import secrets
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.official_web_live_seam_no_promotion import (
    assert_collector_token_ready,
    extract_last_json_object,
    handoff_path_for_run,
    load_env_file,
    preflight_ports,
    query_app_api_run,
    run_json_command,
    start_process,
    terminate_processes,
    wait_for_json,
    write_json,
)
from scripts.official_web_source_pack_artifact_consumer import (
    build_local_artifact_backed_consumer_result,
)
from scripts.official_web_source_pack_artifact_consumer import (
    build_official_web_release_task_store_from_env as _build_official_web_release_task_store_from_env,
)
from scripts.official_web_source_pack_report import (
    _object_list,
    _object_mapping,
    _optional_text,
    _require_text,
    _seeded_rows,
    _sorted_unique,
    assert_source_pack_seam_report,
    build_source_pack_seam_report,
)

build_official_web_release_task_store_from_env = _build_official_web_release_task_store_from_env


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    if args.resume_output_root is not None:
        resume_output_root = (
            args.resume_output_root
            if args.resume_output_root.is_absolute()
            else (repo_root / args.resume_output_root)
        ).resolve()
        seam_report = rebuild_source_pack_seam_report_from_output_root(
            repo_root=repo_root,
            output_root=resume_output_root,
        )
        assert_source_pack_seam_report(seam_report)
        write_json(resume_output_root / "seam-report.json", seam_report)
        print(json.dumps(seam_report, ensure_ascii=False, indent=2))
        return

    local_run_id = f"owrun_source_pack_live_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    output_root = repo_root / args.output_root / local_run_id
    output_root.mkdir(parents=True, exist_ok=True)

    preflight_ports(args.app_api_port, args.handoff_port)
    collector_env = {
        **load_env_file(repo_root / ".env"),
        **load_env_file(repo_root / "apps" / "official-web-collector" / ".env"),
        "OFFICIAL_WEB_APP_API_BASE_URL": f"http://127.0.0.1:{args.app_api_port}",
    }
    app_env_files = {
        **load_env_file(repo_root / "apps" / "app-api" / ".env"),
        **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
    }
    assert_collector_token_ready(app_env_files, collector_env)

    source_pack_plan = load_source_pack_execution_plan(
        repo_root,
        site_id=str(args.site_id),
        source_pack_id=str(args.source_pack_id),
        output_root=output_root,
    )
    source_pack_seed_plan = build_source_pack_seed_plan(source_pack_plan)
    target_seed = seed_source_pack_workset(
        repo_root,
        site_id=str(args.site_id),
        source_pack_id=str(args.source_pack_id),
        source_pack_seed_plan=source_pack_seed_plan,
        output_root=output_root,
    )
    lineage_override_path = write_source_pack_lineage_overrides(
        output_root=output_root,
        target_seed=target_seed,
    )

    handoff_token = secrets.token_hex(32)
    handoff_url = f"http://127.0.0.1:{args.handoff_port}/api/official-web/handoffs"
    processes = []
    closeout_error: BaseException | None = None
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
                (
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
                    str(args.app_api_port),
                ),
                env={
                    **load_env_file(repo_root / "apps" / "app-api" / ".env"),
                    **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
                    "APP_API_OFFICIAL_WEB_HANDOFF_URL": handoff_url,
                    "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN": handoff_token,
                    "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS": "8000",
                    "WRANGLER_DISABLE_EXPERIMENTAL_WARNING": "1",
                    "XDG_CONFIG_HOME": "./.wrangler-home",
                },
                log_path=output_root / "app-api.log",
            )
        )
        wait_for_json(f"http://127.0.0.1:{args.handoff_port}/readyz")
        wait_for_json(f"http://127.0.0.1:{args.app_api_port}/healthz")

        collector_result = run_json_command(
            repo_root,
            build_collector_command(
                args=args,
                local_run_id=local_run_id,
                output_root=output_root,
                target_seed=target_seed,
                source_pack_lineage_path=lineage_override_path,
            ),
            env=collector_env,
            log_path=output_root / "collector.log",
        )
        actual_run_id = str(_object_mapping(collector_result.get("crawlRun")).get("crawlRunId"))
        if not actual_run_id:
            raise RuntimeError("collector result did not include crawlRunId")

        drain_result = run_json_command(
            repo_root,
            (
                "pnpm",
                "--dir",
                "apps/app-api",
                "official-web:drain-projection",
                "--",
                "--limit",
                str(max(10, len(_seeded_rows(target_seed)) * 2)),
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
        consumer_result = build_local_artifact_backed_consumer_result(
            repo_root=repo_root,
            output_root=output_root,
            site_id=str(args.site_id),
            run_id=actual_run_id,
            event_id=event_id,
            app_api_base_url=f"http://127.0.0.1:{args.app_api_port}",
            internal_shared_secret=internal_secret,
        )
        execution_report_path = Path(
            _object_mapping(_object_list(consumer_result.get("results"))[0]).get(
                "execution_report_path"
            )
        ).resolve()
        execution_report = json.loads(execution_report_path.read_text(encoding="utf-8"))
        source_truth_bundle_payload = json.loads(
            (output_root / "collector-output" / "source-truth-bundle.json").read_text(
                encoding="utf-8"
            )
        )
        db_run = query_app_api_run(repo_root, actual_run_id, output_root=output_root)
        seam_report = build_source_pack_seam_report(
            source_pack_plan=source_pack_plan,
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
            source_truth_bundle_payload=source_truth_bundle_payload,
            target_seed=target_seed,
        )
        assert_source_pack_seam_report(seam_report)
        write_json(output_root / "seam-report.json", seam_report)
        print(json.dumps(seam_report, ensure_ascii=False, indent=2))
    except BaseException as exc:
        closeout_error = exc
    finally:
        terminate_processes(processes)
    if closeout_error is not None:
        try:
            seam_report = rebuild_source_pack_seam_report_from_output_root(
                repo_root=repo_root,
                output_root=output_root,
            )
            assert_source_pack_seam_report(seam_report)
            write_json(output_root / "seam-report.json", seam_report)
            print(json.dumps(seam_report, ensure_ascii=False, indent=2))
            return
        except BaseException as rebuild_error:
            raise closeout_error from rebuild_error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run official_web source-pack no-promotion live seam."
    )
    parser.add_argument("--site-id", default="muc_public")
    parser.add_argument("--source-pack-id", default="tool-driven-first-slice.v1")
    parser.add_argument("--app-api-port", type=int, default=27031)
    parser.add_argument("--handoff-port", type=int, default=27041)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("var/official-web-source-pack-live-seam"),
    )
    parser.add_argument(
        "--resume-output-root",
        type=Path,
        default=None,
        help="Rebuild seam-report.json from an existing live seam output directory.",
    )
    parser.add_argument("--max-pages-per-host", type=int, default=6)
    parser.add_argument("--max-total-pages", type=int, default=6)
    return parser


def rebuild_source_pack_seam_report_from_output_root(
    *,
    repo_root: Path,
    output_root: Path,
) -> dict[str, object]:
    if not output_root.exists():
        raise RuntimeError(f"resume output root does not exist: {output_root}")
    source_pack_plan = extract_last_json_object(
        (output_root / "source-pack-plan.log").read_text(encoding="utf-8")
    )
    target_seed = extract_last_json_object(
        (output_root / "target-seed.log").read_text(encoding="utf-8")
    )
    collector_log_path = output_root / "collector.log"
    if collector_log_path.exists():
        collector_result = extract_last_json_object(collector_log_path.read_text(encoding="utf-8"))
    else:
        collector_result = {
            "crawlRun": json.loads(
                (output_root / "collector-output" / "crawl-run.json").read_text(encoding="utf-8")
            ),
            "uploadedArtifacts": [],
        }
    drain_result = extract_last_json_object((output_root / "drain.log").read_text(encoding="utf-8"))
    consumer_result = extract_last_json_object(
        (output_root / "consumer.log").read_text(encoding="utf-8")
    )
    db_run = extract_last_json_object(
        (output_root / "app-api-query.log").read_text(encoding="utf-8")
    )
    source_truth_bundle_payload = json.loads(
        (output_root / "collector-output" / "source-truth-bundle.json").read_text(encoding="utf-8")
    )

    execution_report_matches = sorted(output_root.glob("executions/*/execution-report.json"))
    if len(execution_report_matches) != 1:
        raise RuntimeError(
            f"expected exactly one execution-report.json under {output_root / 'executions'}, found {len(execution_report_matches)}"
        )
    execution_report_path = execution_report_matches[0]
    execution_report = json.loads(execution_report_path.read_text(encoding="utf-8"))

    return build_source_pack_seam_report(
        source_pack_plan=source_pack_plan,
        actual_run_id=_require_text(execution_report.get("runId"), "runId"),
        collector_result=collector_result,
        consumer_result=consumer_result,
        db_run=db_run,
        drain_result=drain_result,
        event_id=_require_text(execution_report.get("eventId"), "eventId"),
        execution_report=execution_report,
        execution_report_path=execution_report_path,
        local_run_id=output_root.name,
        output_root=output_root,
        source_truth_bundle_payload=source_truth_bundle_payload,
        target_seed=target_seed,
    )


def load_source_pack_execution_plan(
    repo_root: Path,
    *,
    site_id: str,
    source_pack_id: str,
    output_root: Path,
) -> dict[str, object]:
    plan = run_json_command(
        repo_root,
        (
            "pnpm",
            "--dir",
            "apps/official-web-collector",
            "plan-source-pack",
            "--",
            "--site-id",
            site_id,
            "--source-pack-id",
            source_pack_id,
        ),
        env={},
        log_path=output_root / "source-pack-plan.log",
    )
    actual_source_pack_id = str(plan.get("sourcePackId") or "").strip()
    if actual_source_pack_id != source_pack_id:
        raise RuntimeError(
            f"source-pack plan id mismatch: expected {source_pack_id}, got {actual_source_pack_id}"
        )
    return plan


def build_source_pack_seed_plan(source_pack_plan: Mapping[str, object]) -> dict[str, object]:
    site_id = _require_text(source_pack_plan.get("siteId"), "siteId")
    source_pack_id = _require_text(source_pack_plan.get("sourcePackId"), "sourcePackId")
    rows = _object_list(source_pack_plan.get("rows"))
    if not rows:
        raise RuntimeError("source-pack execution plan has no rows")
    seeded_rows: list[dict[str, object]] = []
    seen_seed_keys: set[tuple[str, str]] = set()
    for raw_row in rows:
        row = _object_mapping(raw_row)
        entry_id = _require_text(row.get("entryId"), "entryId")
        target_url = _require_text(row.get("url"), "url")
        source_host = _require_text(row.get("host"), "host")
        composition_group = _optional_text(row.get("compositionGroup"))
        composition_role = _optional_text(row.get("compositionRole"))
        target_workset_expansion = _optional_text(row.get("targetWorksetExpansion"))
        for raw_target_match in _object_list(row.get("targetMatches")):
            target_match = _object_mapping(raw_target_match)
            target_id = _require_text(target_match.get("targetId"), "targetId")
            seed_key = (target_id, target_url)
            if seed_key in seen_seed_keys:
                raise RuntimeError(
                    f"duplicate source-pack seeded target row for targetId={target_id} url={target_url}"
                )
            seen_seed_keys.add(seed_key)
            seeded_rows.append(
                {
                    "siteId": site_id,
                    "sourcePackId": _optional_text(target_match.get("sourcePackId"))
                    or source_pack_id,
                    "sourcePackEntryId": _optional_text(target_match.get("sourcePackEntryId"))
                    or entry_id,
                    "entryId": entry_id,
                    "targetUrl": target_url,
                    "sourceHost": source_host,
                    "consumerFamily": _require_text(
                        target_match.get("consumerFamily"), "consumerFamily"
                    ),
                    "materializationPolicy": _require_text(
                        target_match.get("materializationPolicy"), "materializationPolicy"
                    ),
                    "ownerSurface": _require_text(target_match.get("ownerSurface"), "ownerSurface"),
                    "retentionPolicy": _require_text(
                        target_match.get("retentionPolicy"), "retentionPolicy"
                    ),
                    "reviewPolicy": _require_text(target_match.get("reviewPolicy"), "reviewPolicy"),
                    "selectedWriteTarget": str(target_match.get("selectedWriteTarget") or ""),
                    "targetId": target_id,
                    "targetJobId": _require_text(target_match.get("targetJobId"), "targetJobId"),
                    "compositionGroup": _optional_text(target_match.get("compositionGroup"))
                    or composition_group,
                    "compositionRole": _optional_text(target_match.get("compositionRole"))
                    or composition_role,
                    "worksetExpansion": target_workset_expansion,
                }
            )
    return {
        "siteId": site_id,
        "sourcePackId": source_pack_id,
        "entryCount": len(rows),
        "seededRowCount": len(seeded_rows),
        "rows": seeded_rows,
    }


def seed_source_pack_workset(
    repo_root: Path,
    *,
    site_id: str,
    source_pack_id: str,
    source_pack_seed_plan: Mapping[str, object],
    output_root: Path,
) -> dict[str, object]:
    seed_plan_path = output_root / "source-pack-seed-plan.json"
    write_json(seed_plan_path, source_pack_seed_plan)
    code = r"""
(async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { Client } = await import('pg');

  const [siteId, sourcePackId, seedPlanPath] = process.argv.slice(-3);
  const targetMapPath = resolve(
    process.cwd(),
    '..',
    '..',
    'configs',
    'sources',
    'official_web',
    siteId,
    'target-source-map.json',
  );
  const targetMap = JSON.parse(readFileSync(targetMapPath, 'utf8'));
  const seedPlan = JSON.parse(readFileSync(seedPlanPath, 'utf8'));
  const rows = Array.isArray(seedPlan.rows) ? seedPlan.rows : [];
  if (rows.length === 0) {
    throw new Error(`source-pack ${sourcePackId} has no seed rows`);
  }
  const now = new Date().toISOString();
  const client = new Client({
    connectionString: process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB,
  });
  const seededRows = [];
  let previewRequeuedFreshnessRows = 0;
  const seenRequeueUrls = new Set();
  const targetJobIds = new Set();
  const uniqueHosts = new Set();
  const uniqueUrls = new Set();
  await client.connect();
  try {
    await client.query('begin');
    for (const row of rows) {
      const target = targetMap.targets.find((item) => item.target_id === row.targetId);
      if (!target) {
        throw new Error(`target ${row.targetId} is not declared in ${targetMapPath}`);
      }
      const targetUrl = String(row.targetUrl || '').trim();
      const sourceHost = String(row.sourceHost || '').trim().toLowerCase();
      if (!targetUrl || !sourceHost) {
        throw new Error('seed row targetUrl/sourceHost is required');
      }
      if (!Array.isArray(target.source_hosts) || !target.source_hosts.includes(sourceHost)) {
        throw new Error(`target ${row.targetId} does not admit host ${sourceHost}`);
      }
      const candidateId = `owcand_${createHash('sha256')
        .update(`${siteId}:${targetMap.map_version}:${row.targetId}:${targetUrl}`)
        .digest('hex')
        .slice(0, 24)}`;
      const idempotencyKey = `${siteId}:${targetMap.map_version}:${row.targetId}`;
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
          row.targetJobId,
          siteId,
          row.targetId,
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
            $6, 'source_pack_preview_seed', $7, $8, 'eligible',
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
          row.targetJobId,
          siteId,
          row.targetId,
          targetUrl,
          sourceHost,
          target.url_hints[0] || null,
          target.title_hints[0] || null,
          now,
        ],
      );
      if (!seenRequeueUrls.has(targetUrl)) {
        seenRequeueUrls.add(targetUrl);
        const previewRequeueResult = await client.query(
          `
            update official_web.page_freshness
            set
              last_change_reason = 'source_pack_preview_requeue',
              next_eligible_fetch_at = $3,
              updated_at = $3
            where site_id = $1
              and normalized_canonical_url = $2
              and next_eligible_fetch_at > $3
          `,
          [siteId, targetUrl, now],
        );
        previewRequeuedFreshnessRows += previewRequeueResult.rowCount;
      }
      targetJobIds.add(String(row.targetJobId));
      uniqueHosts.add(sourceHost);
      uniqueUrls.add(targetUrl);
      seededRows.push({
        consumerFamily: String(row.consumerFamily),
        compositionGroup: row.compositionGroup ?? null,
        compositionRole: row.compositionRole ?? null,
        entryId: String(row.entryId),
        materializationPolicy: String(row.materializationPolicy),
        sourceHost,
        sourcePackEntryId: String(row.sourcePackEntryId),
        sourcePackId: String(row.sourcePackId || sourcePackId),
        targetCandidateId: candidateId,
        targetId: String(row.targetId),
        targetJobId: String(row.targetJobId),
        targetUrl,
        worksetExpansion: row.worksetExpansion ?? null,
      });
    }
    for (const jobId of targetJobIds) {
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
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({
    declarationVersion: targetMap.map_version,
    previewRequeuedFreshnessRows,
    seededRows,
    sourcePackId,
    targetJobIds: Array.from(targetJobIds).sort(),
    uniqueHosts: Array.from(uniqueHosts).sort(),
    uniqueUrls: Array.from(uniqueUrls).sort(),
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
            site_id,
            source_pack_id,
            str(seed_plan_path),
        ),
        env={
            **load_env_file(repo_root / "apps" / "app-api" / ".env"),
            **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
        },
        log_path=output_root / "target-seed.log",
    )


def write_source_pack_lineage_overrides(
    *,
    output_root: Path,
    target_seed: Mapping[str, object],
) -> Path:
    lineage_overrides = {
        _require_text(row.get("targetCandidateId"), "targetCandidateId"): {
            "sourcePackId": _optional_text(row.get("sourcePackId")),
            "sourcePackEntryId": _optional_text(row.get("sourcePackEntryId")),
            "compositionGroup": _optional_text(row.get("compositionGroup")),
            "compositionRole": _optional_text(row.get("compositionRole")),
        }
        for row in _seeded_rows(target_seed)
    }
    path = output_root / "source-pack-lineage-overrides.json"
    write_json(path, lineage_overrides)
    return path


def build_collector_command(
    *,
    args: argparse.Namespace,
    local_run_id: str,
    output_root: Path,
    target_seed: Mapping[str, object],
    source_pack_lineage_path: Path,
) -> tuple[str, ...]:
    seeded_rows = _seeded_rows(target_seed)
    hosts = _sorted_unique(row.get("sourceHost") for row in seeded_rows)
    target_candidate_ids = _sorted_unique(row.get("targetCandidateId") for row in seeded_rows)
    unique_urls = _sorted_unique(row.get("targetUrl") for row in seeded_rows)
    source_pack_preview_seed_count = sum(
        1
        for row in seeded_rows
        if str(row.get("worksetExpansion") or "").strip() == "same_host_manual_requeue"
    )
    source_pack_preview_seed_count_by_host = Counter(
        _require_text(row.get("sourceHost"), "sourceHost")
        for row in seeded_rows
        if str(row.get("worksetExpansion") or "").strip() == "same_host_manual_requeue"
    )
    per_host_page_counts = Counter(
        _require_text(row.get("sourceHost"), "sourceHost") for row in seeded_rows
    )
    max_pages_per_host = max(
        int(args.max_pages_per_host),
        max(
            (
                per_host_page_counts[host] + source_pack_preview_seed_count_by_host.get(host, 0) * 4
                for host in per_host_page_counts
            ),
            default=0,
        ),
    )
    max_total_pages = max(
        int(args.max_total_pages),
        len(unique_urls) + source_pack_preview_seed_count * 4,
    )
    command = [
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
        "--max-pages-per-host",
        str(max_pages_per_host),
        "--max-total-pages",
        str(max_total_pages),
        "--crawl-run-id",
        local_run_id,
        "--scheduler-run-key",
        f"manual-source-pack-live-{local_run_id}",
        "--trace-id",
        f"trace-{local_run_id}",
        "--disable-conditional-headers",
        "--output-dir",
        str(output_root / "collector-output"),
        "--source-pack-lineage-path",
        str(source_pack_lineage_path),
    ]
    for host in hosts:
        command.extend(("--host", host))
    for target_candidate_id in target_candidate_ids:
        command.extend(("--target-candidate-id", target_candidate_id))
    return tuple(command)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"official_web source-pack live seam failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
