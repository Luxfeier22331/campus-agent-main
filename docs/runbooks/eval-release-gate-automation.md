---
doc_type: runbook
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-04-23
updated: 2026-06-19
---
# Eval Release Gate Automation

## Purpose

本 runbook 固定 repo-owned shared eval automation 入口：

- `python -m scripts.eval_gate doctor`
- `python -m scripts.eval_gate accept`
- `python -m scripts.eval_gate publish`

它不替代：

- per-corpus baseline 文档
- `packages/evals` 各自 CLI 的低层实现
- golden dataset governance

## Supported Profiles

- `campus-services-product-path`
- `multi-agent-runtime-contract`
- `online-answer-path`
- `tool-family-denominator`
- `tool-routing-product-path`
- `document-quality`
- `authz-privacy`
- `agentic-retrieval-plan`
- `answer-quality-contract`
- `hindsight-memory-product-path`
- `eval-operations-governance`
- `quality-calibration`

## Doctor

最小 doctor：

```bash
uv run --all-packages python -m scripts.eval_gate doctor --json
```

需要额外审计 worker secret presence 时：

```bash
uv run --all-packages python -m scripts.eval_gate doctor \
  --check-worker-secrets \
  --worker-env staging \
  --json
```

## Acceptance

通用 profile gate：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile tool-family-denominator \
  --observations-path <observations.json> \
  --json
```

需要 runtime collection 的 profile 必须显式传入 observation / artifact；automation
不会启动旧 Python live runner，也不会从 Qdrant / app-api 隐式采样。

旧 corpus-specific 与 service-specific Python release profile 已从 active registry
移除。对应的 student rules、curriculum、official-web、service/contact 与
institutional rules 证据应由当前 TS/Go runtime owner 产出 sanitized release
acceptance / retrieval artifact，再交给 coverage snapshot 或 active profile 消费。

campus services product path opening gate：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile campus-services-product-path \
  --json
```

`campus-services-product-path` 聚合：

- tool-family denominator 中的 service-guide / contact-directory cases
- Go structured runtime matrix tests
- `app-api` runtime tests + typecheck
- `campus-web` worker E2E + typecheck

artifact 默认写入：

- `campus-services-product-path-opening-gate.json`
- `summary.opened_tools[] / blocked_tools[]`
- `tool_verdicts[]`（按 tool 粒度的 `open|blocked`）

## Campus Services Rollout / Rollback

这是 `campus-services-product-path` gate 对应的固定运营契约：

- rollout flag（Go-owned）：
  - runtime profile `open_capabilities=["campus_services"]`
- opening 前必须同时满足：
  - gate artifact `summary.failed_checks=0`
  - `execution-control /readyz` 中 `capability_gates.campus_services.open=true`
  - `app-api` 与 `campus-web` `/readyz` 中
    `preflight.campusServicesProductPath.status=ready`
- rollback 条件（任一命中即回滚）：
  - opening gate 出现 failed checks
  - `/readyz preflight` 出现 `status=blocked` 或关键 check `not_ready`
  - public/chat 回答出现 source trace 泄漏（如 release id/projection internals/raw ref id）
- rollback 操作：
  - 从 runtime profile `open_capabilities` 移除 `campus_services` 后重新部署
  - 复核 `/readyz` 已回到 capability gate closed

source trace 观察点（browser-safe）：

- chat structured parts：`campus_service_trace_cards`
- app-api request projection：`selectedCapability`、`status`、`allowed_tool`、`payload_kind`
- preflight blocker：`preflight.campusServicesProductPath.blockers`

## Publish

automation 默认只做 publish dry-run：

```bash
uv run --all-packages python -m scripts.eval_gate publish \
  --case-results <run-XX-case-results.json> \
  --grade-source eval_release_gate \
  --grader-version grader@2026-04-23 \
  --json
```

如需显式真实 publish，必须手工添加：

```bash
--no-dry-run
```

## GitHub Actions

repo 级 manual workflow 使用：

- `.github/workflows/eval-release-gate.yml`

它只承担：

- manual dispatch
- env doctor
- optional real staging observation collection for `online-answer-path`
- shared acceptance
- optional publish dry-run
- optional `online-answer-path` Langfuse score publish
- artifact upload

它不是 PR 必过检查。

`online-answer-path` 的真实主链路 artifact 应先由 staging collector 生成，再交给
profile gate。默认 collector 与 profile gate 只消费
`release_gate` / `regression_locked` case；全量 exploratory / known-gap /
blocked-capability 复盘必须显式使用 `--cases-path` 跑离线 profile gate。当前 durable
staging collector 只证明 completed release 子集，不能用于 full-suite fail-closed /
clarification 采集：

```bash
pnpm --dir apps/app-api online-answer-path:collect:staging -- \
  --output <artifact_dir>/observations.json

uv run --all-packages python -m scripts.eval_gate accept \
  --profile online-answer-path \
  --observations-path <artifact_dir>/observations.json \
  --output-dir <artifact_dir>
```

`publish_langfuse_scores` 只对 `online-answer-path` 生效。启用后，workflow 会在
acceptance 完成后执行：

```bash
pnpm --dir packages/eval-langfuse langfuse \
  build-score-report-from-profile \
  --profile-report <artifact_dir>/profile-report.json \
  --output <artifact_dir>/langfuse-score-report.json \
  --json

pnpm --dir packages/eval-langfuse langfuse \
  publish-score-report \
  --score-report <artifact_dir>/langfuse-score-report.json \
  --json
```

第一步把 `profile-report.json` 转为 `langfuse_score_report.v1`；第二步发布
generic score report 到 Langfuse score API。该步骤读取
`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、
`LANGFUSE_SECRET_KEY` 与 `LANGFUSE_ENVIRONMENT`。配置缺失或 Langfuse
request 失败会让步骤失败；Langfuse 只作为 eval score sink，不成为产品真相源。

## Langfuse Eval Platform Lane

`pnpm ci:langfuse` 固定覆盖 TS Langfuse package typecheck/test 与
app-api trace id vector。

本 lane 的事实边界：

- `packages/evals` 拥有 case schema、qrels 与 deterministic scorer；
  `packages/eval-langfuse` 拥有 Langfuse score report、platform sync 与 release verdict。
- Langfuse 只接收 sanitized dataset、experiment、score、annotation 与 trace
  drill-down 投影。
- 缺 Langfuse 配置、缺 dataset version、缺 trace correlation、score denominator
  不完整或 payload 含禁用字段时，eval / release lane fail closed。

### Score Config Sync

score name 必须先进入
`packages/evals/fixtures/ops/langfuse_score_registry.v1.json`，再允许发布。
同步到 Langfuse score configs：

```bash
pnpm --dir packages/eval-langfuse langfuse \
  sync-score-configs \
  --registry packages/evals/fixtures/ops/langfuse_score_registry.v1.json \
  --dry-run \
  --json
```

真实同步时去掉 `--dry-run`。registry 仍是 source of truth，Langfuse score
config 只是平台侧校验副本。

### Dataset Sync

dataset manifest 使用 repo fixture path 和稳定 dataset slug，不把 fixture hash
写入 item id。dry-run：

```bash
pnpm --dir packages/eval-langfuse langfuse \
  sync-datasets \
  --dataset-manifest <langfuse-dataset-manifest.json> \
  --dry-run \
  --json
```

manifest 中每个 item 必须能追溯 `source_fixture_path`、`source_git_head`、
`fixture_hash`、`surface_key` 与 `case_id`。删除 fixture case 时默认输出
tombstone / archive plan，不做 irreversible delete。

当前支持的 dataset `kind`：

- `rag_qrels`
- `answer_quality`
- `release_acceptance`
- `online_answer_path`
- `known_gap_review_seed`

query / user goal 只以 hash 进入 dataset input；expected output 使用 repo fixture
中的 sanitized contract projection。

### RAG First-stage Parameter Sweep

Go runner 只负责用真实 execution-control RAG runtime 产出 per-surface candidate
result。它不发布 Langfuse score，也不写产品 projection。

```bash
cd apps/execution-control

go run ./cmd/rag-first-stage-eval-runner \
  --qrels ../../packages/evals/fixtures/<surface>/retrieval_qrels.json \
  --output ../../.tmp/rag-eval/student-rules-topk3-d20-s20.json \
  --variant-id topk3-d20-s20 \
  --top-k 3 \
  --dense-prefetch-limit 20 \
  --sparse-prefetch-limit 20 \
  --rrf-k 60 \
  --rrf-dense-weight 1 \
  --rrf-sparse-weight 1 \
  --json
```

运行该命令需要真实 Qdrant query env 与本地 provider projection artifact：

- `QDRANT_URL`
- `QDRANT_QUERY_API_KEY`
- `QDRANT_TLS_CA_CERT_PATH`（非 local http Qdrant）
- `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH` 或
  `EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH`

projection artifact 由 `scripts/sync-provider-config-projection.mjs` 从 app-api
provider-config active profiles 显式生成；runner 不在热路径调用 app-api provider-config
resolver。

runner 对每个 case 执行 dense prefetch、sparse prefetch 与 hybrid RRF final
查询，并写出 `rag_first_stage_candidate_result.v1`。它只记录 doc/version/chunk/score
等 sanitized evidence identity，不记录 query body、snippet 或 source body。

Python deterministic aggregator 由测试或专用调用方消费多个 candidate result，
计算 metrics 并产出 sweep report。

输出：

- `.tmp/rag-eval/sweep/rag-first-stage-parameter-sweep.json`
- `.tmp/rag-eval/sweep/<surface>/<variant>.json`

Langfuse score report 生成和发布归属 `packages/eval-langfuse`，不得从
Python eval runner 直接写入 Langfuse artifacts。

### Experiments

Langfuse-hosted dataset experiment runner 必须先写 repo artifact，再发布 score：

```bash
pnpm --dir packages/eval-langfuse langfuse \
  run-experiment \
  --experiment-manifest <langfuse-experiment-manifest.json> \
  --json
```

runner 会写：

- `langfuse_experiment_result.v1` artifact
- `langfuse_score_report.v1` artifact
- Langfuse dataset run item evidence（仅当 `dataset_source=langfuse`）
- local fixture experiment 不声称存在 Langfuse dataset run；缺少真实 trace /
  session / dataset run identity 的 score 会进入 `omitted_items[]`
- 如 manifest 提供 `baseline_artifact_path`，artifact 会写入 aggregate score delta
  comparison，用于 accepted baseline / historical comparison

CI / release verdict 只信 repo artifact 的 deterministic verdict，不直接信
Langfuse UI 状态。

### Annotation Review

low-score、failed 或 known-gap case 可以进入 Langfuse annotation queue：

```bash
pnpm --dir packages/eval-langfuse langfuse \
  sync-annotation-queue \
  --review-manifest <langfuse-review-manifest.json> \
  --dry-run \
  --json
```

完成 review 后导出 repo artifact：

```bash
pnpm --dir packages/eval-langfuse langfuse \
  export-review-results \
  --review-manifest <langfuse-review-manifest.json> \
  --output .tmp/langfuse-review-export.json \
  --json
```

人工 review 只能生成 backlog / fixture candidate，不能直接覆盖 deterministic
release verdict。

review export artifact 会包含 queue id、case id、score config id 列表、
reviewer score summary、comment hash 与 repo backlog candidate id。

### Operator-safe Backlink

Operator Console 不直接查 Langfuse。eval lane 如需展示 Langfuse drill-down，只能
把 sanitized backlink 写入 app-api internal projection：

- API endpoint: `POST /api/internal/operator/langfuse/eval-backlinks`
- Python client: `OperatorObservabilityClient.ingest_langfuse_eval_backlinks(...)`
- query endpoint: `GET /api/operator/langfuse/eval-backlinks?traceId=<trace_id>`

backlink payload 只允许 request / trace identity、`eval_run_id`、`score_name`、
`score_value`、`release`、`environment` 与 `langfuse_url`。不得包含 raw prompt、
raw answer、retrieved snippet、source body、provider response 或 secret。
