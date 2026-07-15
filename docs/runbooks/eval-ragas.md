---
doc_type: runbook
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-04-23
updated: 2026-07-13
---
# Ragas

## Local Verification

```bash
pnpm ci:eval
```

This runs TypeScript adapter tests and the isolated Python Ragas tests. It does
not call Langfuse or model providers.

## Build And Sync Datasets

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  build-dataset-manifest \
  --output .tmp/langfuse-datasets.json \
  --json

pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  sync-datasets \
  --dataset-manifest .tmp/langfuse-datasets.json \
  --dry-run \
  --json
```

Remove `--dry-run` only when the target Langfuse project is correct. The
manifest creates one dataset per `cases.v1.json` below both
`assets/datasets/agent` and `assets/datasets/rag`.

## Sync Score Configs

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  sync-score-configs --dry-run --json
```

Only names in
`packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json` may
be published.

## Score Traces

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  ragas-score-traces \
  --trace-name <trace-name> \
  --release <release> \
  --limit <count> \
  --validate-only \
  --json
```

The TypeScript adapter selects Langfuse traces, builds safe Ragas samples,
invokes `packages/ragas-runner` and validates score payloads. Remove
`--validate-only` to publish registered scores.

## Score Dataset Runs

Run the dataset through the real product path and publish Agent plus applicable
RAG scores:

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  agent-eval \
  --app-api-base-url <app-api-url> \
  --dataset campus/rag/student_rules \
  --limit <count> \
  --json
```

Use `--dataset campus/agent/routing` for the primary-agent routing benchmark.
RAG datasets additionally publish applicable answer/context metrics.

Provide `CAMPUS_EVAL_COOKIE_HEADER`, or configure
`APP_API_STAGING_SMOKE_AUTH_SECRET` so the runner can mint an authenticated
session. Optional setup turns run in the same conversation as the target turn.
The runner links the target product trace with Langfuse
`POST /api/public/dataset-run-items`, then publishes Ragas Agent/RAG scores and
the registered deterministic BOOLEAN scores. The returned dataset run id stays
in internal sample lineage. Each score request carries exactly one
`observationId` or `traceId` and does not send dataset item/run ids to
`POST /api/public/scores`.

To rescore already materialized Langfuse items:

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  ragas-score-dataset \
  --dataset campus/rag/student_rules \
  --limit <count> \
  --validate-only \
  --json
```

Dataset scoring requires materialized answer and retrieved contexts from a
dataset run or linked trace. Repo case truth alone is not a generated run and
must fail closed when those fields are absent.

## Trace Verification

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  verify-trace \
  --product-trace-id <trace-id> \
  --session-id <conversation-id> \
  --user-id <safe-user-id> \
  --release <release> \
  --json
```

Run external scoring only from an approved eval environment with Langfuse and
model credentials. It is not a normal feature-development check or automatic
release gate.
