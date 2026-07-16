---
doc_type: runbook
owner_boundary: packages/eval-langfuse
status: active
---

# Ragas 评测

## 本地检查

```bash
pnpm ci:eval
```

该命令运行 TypeScript 适配器和隔离的 Python Ragas 测试，不访问 Langfuse 或模型服务。

## 构建与同步 Dataset

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

manifest 从 `assets/datasets/agent` 和 `assets/datasets/rag` 下的 `cases.v1.json` 各生成一个
dataset。确认目标 Langfuse project 后才移除 `--dry-run`。

## 同步 Score 配置

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  sync-score-configs --dry-run --json
```

只允许发布 `assets/registries/langfuse_score_registry.v1.json` 登记的名称。

## 评分 Trace

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  ragas-score-traces \
  --trace-name <trace-name> \
  --release <release> \
  --limit <count> \
  --validate-only \
  --json
```

TypeScript 适配器读取 Langfuse trace、构造安全 Ragas sample、调用
`packages/ragas-runner` 并校验 score payload。确认样本和目标后才移除 `--validate-only`。

## 执行 Dataset

通过真实产品路径执行并发布适用的 Agent/RAG score：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  agent-eval \
  --app-api-base-url <app-api-url> \
  --dataset campus/rag/student_rules \
  --limit <count> \
  --json
```

路由 benchmark 使用 `--dataset campus/agent/routing`。需要提供
`CAMPUS_EVAL_COOKIE_HEADER`，或配置允许 runner 创建评测 session 的 staging auth secret。

setup turn 与目标 turn 使用同一 conversation。runner 将目标 product trace 关联到 Langfuse
dataset-run-item，再发布 Ragas 和确定性 BOOLEAN score。dataset run ID 只保留为内部 lineage。

## 重新评分

仅当 Langfuse 中已经存在 materialized answer、retrieved context 和关联 trace 时使用：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  ragas-score-dataset \
  --dataset campus/rag/student_rules \
  --limit <count> \
  --validate-only \
  --json
```

仓库 case truth 不是运行结果。缺少 materialized 字段时必须失败，不能用 reference 伪造检索。

## 验证 Trace

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  verify-trace \
  --product-trace-id <trace-id> \
  --session-id <conversation-id> \
  --user-id <safe-user-id> \
  --release <release> \
  --json
```

外部评分只在批准的评测环境中运行。它不是普通功能开发检查，也不会自动形成发布 gate。命令输出
属于本次评测记录，不提交到仓库。
