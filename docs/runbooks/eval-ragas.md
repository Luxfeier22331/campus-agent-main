---
doc_type: runbook
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-04-23
updated: 2026-06-29
---
# Eval Ragas

<!-- markdownlint-disable MD013 -->

## Purpose

This runbook records the active Langfuse/Ragas scoring automation after
retiring repo-owned profile gates, artifact score publishers and app-api eval
backlink projections.

Active repo commands:

- `uv run --all-packages python -m scripts.langfuse_eval_audit doctor --json`
- `uv run --all-packages python -m scripts.langfuse_eval_audit audit --json`
- `pnpm --dir packages/eval-langfuse langfuse ragas-score-traces`
- `pnpm --dir packages/eval-langfuse langfuse ragas-score-dataset`
- `pnpm --dir packages/eval-langfuse langfuse build-rag-dataset-manifest`
- `pnpm --dir packages/eval-langfuse langfuse sync-score-configs`
- `pnpm --dir packages/eval-langfuse langfuse sync-datasets`

Retired paths must not be used for new automation:

- `run-experiment`
- `sync-annotation-queue`
- `export-review-results`
- `build-online-answer-results`
- `build-runtime-config-results`
- `build-score-report-from-online-answer`
- `build-score-report-from-runtime-config`
- `publish-score-report`
- `run-ragas-scoring`
- `build-ragas-sample-batch`
- `closeout-staging`
- app-api `online-answer-path:collect:staging`
- app-api Langfuse eval backlink ingest/query routes
- Go `cmd/intent-eval-runner`

## Execution Surface

Ragas/Langfuse scoring is an internal eval shell/runtime capability. It is not
exposed as a GitHub Actions workflow.

Run scoring from a configured internal eval environment that has the repo
workspace, Node, Python, uv, Langfuse credentials, model credentials and optional
Ragas runtime config available. GitHub Actions must not own this scoring lane.

Use `--validate-only` for dry validation. Without `--validate-only`, the command
may write `ragas.*` scores to Langfuse through the configured internal eval
credentials.

## Ragas Trace Scoring

```bash
pnpm --dir packages/eval-langfuse langfuse \
  ragas-score-traces \
  --trace-name <optional-trace-name> \
  --tag <optional-trace-tag> \
  --release <optional-release> \
  --limit <positive-int> \
  --runtime-config <optional-ragas-runtime-config.json> \
  --validate-only \
  --json
```

The TS adapter queries Langfuse traces, extracts only eval-safe fields from
trace/observation metadata, invokes `packages/ragas-runner`, and publishes or
validates Langfuse score payloads.

## Ragas Dataset Scoring

```bash
pnpm --dir packages/eval-langfuse langfuse \
  ragas-score-dataset \
  --dataset <langfuse-dataset-name> \
  --dataset-version <optional-version> \
  --limit <positive-int> \
  --runtime-config <optional-ragas-runtime-config.json> \
  --validate-only \
  --json
```

Dataset items must be materialized before scoring. A materialized item contains
or links to safe RAG eval projection fields: question or `user_input`, answer,
retrieved contexts, optional retrieved/reference context ids, trace id and
dataset item identity.

Repo qrels assets do not contain generated answers or retrieved context text,
so qrels-only dataset items fail closed. They can be synced as Langfuse dataset
truth, then materialized by a dataset run or linked trace / observation before
`ragas-score-dataset` is invoked.

## Score Config Sync

The registry is:

```text
packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json
```

It currently contains active `ragas.*` score configs:

- `ragas.faithfulness`
- `ragas.answer_relevancy`
- `ragas.context_precision`
- `ragas.context_recall`
- `ragas.context_precision_without_reference`
- `ragas.id_context_precision`
- `ragas.id_context_recall`

Dry-run:

```bash
pnpm --dir packages/eval-langfuse langfuse sync-score-configs \
  --registry packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json \
  --dry-run --json
```

Remove `--dry-run` to create missing Langfuse score configs.

## Dataset Manifest And Sync

Build a manifest from active repo RAG eval assets:

```bash
pnpm --dir packages/eval-langfuse langfuse \
  build-rag-dataset-manifest \
  --output .tmp/langfuse-rag-dataset-manifest.json \
  --json
```

The builder includes:

- qrels and golden qrels assets as `rag_qrels`
- answer-quality assets as `answer_quality`

`rag_qrels` dataset items carry query identity and `reference_context_ids`.
They deliberately do not invent `answer` or `retrieved_contexts`.

```bash
pnpm --dir packages/eval-langfuse langfuse \
  sync-datasets \
  --dataset-manifest <langfuse-dataset-manifest.json> \
  --dry-run \
  --json
```

Dataset manifests should point at repo eval assets that can become Langfuse
dataset items. Current accepted kinds are RAG / answer-quality / agent dataset
shapes handled by `packages/eval-langfuse/src/platform.ts`; the retired
`online_answer_path` profile shape is not accepted.

Langfuse experiments and annotation queues remain official platform workflows.
This repo does not maintain custom experiment-manifest or review-manifest
automation; use Langfuse SDK/UI workflows directly when those surfaces are
needed.
