---
doc_type: runbook
owner_boundary: packages/eval-langfuse
status: active
---

# Ragas 评测

## 边界

本文说明如何通过 `packages/eval-langfuse` 使用 Langfuse 数据集和 trace，并由
`packages/ragas-runner` 调用 Ragas 官方指标。普通功能开发只运行本地检查；真实产品请求、外部
模型评分和发布比较只在明确的评测或发布任务中执行。

TypeScript 适配器拥有 Langfuse 交互、数据集关联、产品路径执行和 score 发布。Python runner
只接收受控 sample、调用 Ragas 并返回结构化结果，不连接 Langfuse，也不建立另一套实验或发布
判断。

## 本地检查

```bash
pnpm --dir packages/eval-langfuse typecheck
pnpm --dir packages/eval-langfuse test
pnpm --dir packages/ragas-runner test:eval
```

这些命令运行 TypeScript 适配器和隔离的 Python Ragas 测试，不访问 Langfuse 或模型服务。

## 模型配置

需要调用模型指标时，通过 `--provider-config-projection` 指向未跟踪的
`provider_config_projection.v1` JSON 文件。该文件必须是当前用户拥有、权限严格为 `0600` 的普通
文件，不能是符号链接，并且必须完整提供 `eval_judge_llm`、`eval_ragas_llm` 和
`eval_ragas_embedding` 三个 role。适配器按评测类型生成短生命周期的 `0600` Ragas 配置，并在
调用结束后删除。

精确字段和执行限制以 provider projection schema、`packages/eval-langfuse/src/provider-config.ts`
及其测试为准。不要从 execution-control 的在线模型配置推导离线评测配置，也不要恢复
Python runner 使用的临时运行配置由 TypeScript 入口生成，不由调用方提供。

## 数据集

先从仓库评测用例生成 manifest，并预览 Langfuse 变更：

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

检查 manifest 和目标 Langfuse project 后才移除 `--dry-run`。仓库用例是预期输入，不是已经
发生的产品运行结果。

## Score 配置

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  sync-score-configs --dry-run --json
```

只发布 score registry 已登记的名称。确认差异和目标 project 后才执行写入。

## 执行真实产品路径

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  agent-eval \
  --app-api-base-url <app-api-url> \
  --cookie-header '<cookie-header>' \
  --dataset <dataset-name> \
  --environment <environment> \
  --provider-config-projection <provider-config-projection.json> \
  --limit <count> \
  --json
```

命令通过 App API 执行 Langfuse dataset item，把目标 turn 关联到真实 product trace，再发布适用
的 Ragas 和确定性 score。认证输入来自批准的评测环境，不能写入仓库。setup turn 与目标 turn
使用同一 conversation，dataset run identity 只用于关联。`--app-api-base-url`、`--cookie-header`、
`--dataset`、`--environment` 和 `--provider-config-projection` 都是该命令的显式必填参数；命令不会
从其他环境变量推断它们。

## 评分现有 Trace

按 trace 条件选择已经发生的产品请求：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  ragas-score-traces \
  --trace-name <trace-name> \
  --environment <environment> \
  --provider-config-projection <provider-config-projection.json> \
  --release <release> \
  --limit <count> \
  --validate-only \
  --json
```

TypeScript 适配器读取 Langfuse trace、构造受控 Ragas sample 并校验结果。先检查样本和目标，再
移除 `--validate-only`。

仅当 Langfuse dataset run 已经保存真实 answer、retrieved context 和关联 trace 时，才重新评分：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  ragas-score-dataset \
  --dataset <dataset-name> \
  --environment <environment> \
  --provider-config-projection <provider-config-projection.json> \
  --limit <count> \
  --validate-only \
  --json
```

缺少已物化字段时必须失败，不能用 reference 或 fixture 伪造检索结果。

## 发布评测

retrieval 或 Agent 工具选择发生变化时：

1. 确认 Campus Docs 当前索引绑定、publisher 索引定义和工具合同通过所属可执行校验；
2. 运行 contracts check、手动 `go` profile 和手动 `ragas` profile；
3. 确认 Langfuse dataset 包含本次行为及直接相关的反例；
4. 通过真实产品路径生成 answer、retrieved context、tool trajectory 和 trace identity；
5. 与已接受的基准运行比较适用的 Ragas、Agent 和确定性 score；
6. 逐项审查失败用例，特别是无答案、跨目标和禁止上下文场景。

Ragas score 用于评审，不自动决定发布。合同完整性和依据约束仍由所属运行时测试判断；仓库不生成
第二套 gate report。

## Trace 关联检查

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  verify-trace \
  --product-trace-id <trace-id> \
  --session-id <conversation-id> \
  --user-id <safe-user-id> \
  --release <release> \
  --json
```

外部评分结果属于本次评测或发布记录，不提交到仓库。

## 相关文档

- `docs/reference/eval.md`
- `packages/eval-langfuse/README.md`
- `packages/ragas-runner/README.md`
