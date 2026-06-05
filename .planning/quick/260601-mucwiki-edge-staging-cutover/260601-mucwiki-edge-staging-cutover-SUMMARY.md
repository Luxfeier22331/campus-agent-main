# Quick Task 260601-mucwiki-edge-staging-cutover Summary

## What Closed

- cut campus-agent staging hostnames away from `ayafeed.com` and onto the repo-owned
  `mucwiki-edge.link` zone:
  - `api-staging.mucwiki-edge.link` -> `app-api-staging`
  - `hub-staging.mucwiki-edge.link` -> `hub-web-staging`
  - `chat-staging.mucwiki-edge.link` -> `public-chat-web-staging`
  - `docs-staging.mucwiki-edge.link` -> `public-docs-staging`
  - `panel-staging.mucwiki-edge.link` -> `protected-panel-web-staging`
  - `exec-staging.mucwiki-edge.link` -> `supervisor-api-staging` Cloudflare Tunnel
- hardened staging env loading so `.env.staging.local` is the explicit local overlay for
  staging smoke/deploy helpers, without silent fallback to legacy staging hostnames
- added a public-docs staging deploy wrapper so docs deploy uses the same staging
  preflight and hostname discipline as the other Worker apps
- converted supervisor staging operations to the `nc-arm-6c` remote host posture:
  `/srv/apps/campus-agent`, Docker-first supervisor runtime, and
  `supervisor-api-staging` named Tunnel
- added `cloudflared` systemd install support for the remote staging host
- strengthened supervisor staging status so `status-supervisor-api-staging.sh --check`
  fails closed on runtime RAG release readiness, not merely process or transport health
- expanded the RAG runtime probe to report Qdrant endpoint readiness, alias resolution,
  release manifest availability, metadata guard, and alias guard status without throwing
  tracebacks on bad endpoints
- added collection rename backfill/audit coverage for the old
  `student_handbook` / `institutional_regulations` names into the current
  `student_rules` / `institutional_rules` registry names
- split the oversized supervisor bridge Go test file back under the repo decomposition
  budget instead of admitting a new baseline exception
- updated architecture, environment, and runbook docs so `mucwiki-edge.link` is the
  current staging deploy truth; `hub.muc.wiki` production custom-hostname activation is
  outside this staging cutover

## Cloudflare State Verified

- `mucwiki-edge.link` zone is active in account `linear27`
- Worker custom domains exist for all five staging Worker surfaces:
  - `api-staging.mucwiki-edge.link` -> `app-api-staging`
  - `hub-staging.mucwiki-edge.link` -> `hub-web-staging`
  - `chat-staging.mucwiki-edge.link` -> `public-chat-web-staging`
  - `docs-staging.mucwiki-edge.link` -> `public-docs-staging`
  - `panel-staging.mucwiki-edge.link` -> `protected-panel-web-staging`
- Access application exists for `panel-staging.mucwiki-edge.link` with a human allow
  policy and service-token smoke policy
- Tunnel `supervisor-api-staging` is healthy, id
  `7d0db8a7-53bd-417d-8028-548c35c8e30e`, with ingress:
  - `exec-staging.mucwiki-edge.link -> http://127.0.0.1:27051`
  - final catch-all `http_status:404`

## Current Blockers

- staging is not product-ready yet because the RAG data plane is not ready.
- `nc-arm-6c` strict status currently fails with:
  - `qdrant_ready=not_ready`
  - `/readyz`, `/livez`, `/collections` all return `404 page not found`
  - `regulations/student_rules`, `regulations/institutional_rules`, and
    `curriculum/curriculum_plan` all report `qdrant_endpoint_not_ready`
- redacted endpoint shape from the remote host:
  - scheme: `https`
  - host:
    `e3ae1c33-0bce-466a-a68c-299e5714a611.us-east4-0.gcp.cloud.qdrant.io`
  - path: `/`
  - API key is present
- this is a bad or stale Qdrant REST endpoint, not a Worker/Tunnel routing issue.
  The next unblock requires a Qdrant URL/key pair that returns `200` for
  `/readyz`, `/livez`, and `/collections` from `nc-arm-6c`.

## Explicitly Out Of Current Scope

- `hub.muc.wiki` production custom-hostname activation is not part of the current
  `mucwiki-edge.link` staging cutover.
- do not retry Cloudflare for SaaS custom-hostname / fallback-origin API work for this
  staging closeout.

## Verification

- `pnpm web:lint`
- `pnpm web:typecheck:affected`
- `pnpm web:test:affected`
- `pnpm web:build:affected`
- `pnpm docs:lint`
- `pnpm yaml:lint`
- `pnpm decomposition:lint`
- `uv run --all-packages python -m unittest tests.ingestion.test_collection_rename_registry_backfill tests.ingestion.test_collection_rename_registry_backfill_worker tests.ingestion.test_probe_regulation_rag_release_runtime_worker tests.test_supervisor_api_staging_preflight tests.test_load_repo_env -q`
- `uv run --all-packages ruff check apps/ingestion-worker/src/campus_ingestion_worker/collection_rename_registry_backfill.py apps/ingestion-worker/src/campus_ingestion_worker/probe_regulation_rag_release_runtime.py packages/ingestion-core/src/campus_ingestion_core/collection_rename_registry_backfill.py tests/ingestion/test_collection_rename_registry_backfill.py tests/ingestion/test_collection_rename_registry_backfill_worker.py tests/ingestion/test_probe_regulation_rag_release_runtime_worker.py tests/test_supervisor_api_staging_preflight.py`
- `uv run --all-packages ruff format apps/ingestion-worker/src/campus_ingestion_worker/collection_rename_registry_backfill.py apps/ingestion-worker/src/campus_ingestion_worker/probe_regulation_rag_release_runtime.py packages/ingestion-core/src/campus_ingestion_core/collection_rename_registry_backfill.py tests/ingestion/test_collection_rename_registry_backfill.py tests/ingestion/test_collection_rename_registry_backfill_worker.py tests/ingestion/test_probe_regulation_rag_release_runtime_worker.py tests/test_supervisor_api_staging_preflight.py --check`
- `bash -n infra/local/staging/supervisor-api-staging-common.sh infra/local/staging/status-supervisor-api-staging.sh infra/local/staging/start-supervisor-api-staging.sh infra/local/staging/install-supervisor-api-staging-cloudflared-service.sh`
- `pnpm --dir apps/protected-panel-web test -- worker.runtime-config.suite.ts`
- `pnpm --dir apps/app-api test -- worker-deploy-config-verifier.test.ts staging-docs-gated-smoke.args.test.ts smoke-identity-provision.test.ts staging-smoke-auth.route.test.ts`
- `(cd apps/supervisor-api && go test ./internal/httpapi)`
- `git diff --check`

## Deferred Until Qdrant Is Corrected

- `pnpm --dir apps/app-api chat:e2e:staging`
- `pnpm --dir apps/app-api docs:gated:smoke:staging`
- `pnpm --dir apps/protected-panel-web access:smoke:staging`
- final `api-staging` / `chat-staging` / `docs-staging` / `panel-staging` public smoke
  evidence

These are intentionally not marked green while the strict RAG runtime readiness gate is
red.
