---
doc_type: runbook
owner_boundary: packages/eval-langfuse
status: active
---

# Ragas 评测

## 边界

Ragas 是离线评分器。它只读取调用方显式提供的 JSON 样本和本地模型配置文件，不连接 Langfuse，
不选择数据集，不读取普通 trace，也不生成持久报告或发布判断。

`packages/eval-langfuse` 负责解析 Agent 用例、可选的真实产品路径执行、确定性检查和 Langfuse
score 适配。`packages/ragas-runner` 负责把 native Ragas 样本交给 Ragas 官方指标并输出结构化结果。
两者之间通过临时文件传递，不把平台身份混入 RAG 样本。

## 本地合同检查

```bash
pnpm --dir packages/eval-langfuse typecheck
pnpm test --filter=eval-langfuse
pnpm --dir packages/ragas-runner test:eval
```

这些命令只运行 TypeScript 适配器和隔离的 Python 测试，不访问 Langfuse、App API 或外部模型。

## Native Ragas 批次

RAG 样本使用 `ragas_sample_batch.v3`：

```json
{
  "schema_version": "ragas_sample_batch.v3",
  "items": [
    {
      "case_id": "library-hours",
      "user_input": "图书馆开放时间是什么？",
      "response": "图书馆开放时间为 08:00 到 22:00。",
      "retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
      "cited_contexts": ["图书馆开放时间为 08:00-22:00。"],
      "reference": "图书馆开放时间为 08:00-22:00。",
      "metadata": {"surface_key": "app-api.chat"}
    }
  ]
}
```

每条 RAG 样本只包含 `case_id`、`user_input`、`response`、`retrieved_contexts`、
`cited_contexts`、可选 `reference` 和标量 `metadata`。前者是全部检索候选，后者是答案实际引用
的候选；空数组仍是有效输入，不能因为为空而丢弃样本。`trace_id`、
`observation_id`、dataset run、context ID、凭据和本地路径不属于 native Ragas 合同。

使用当前 runner：

```bash
uv run --package campus-ragas-runner python -m campus_ragas_runner rag \
  --input .tmp/ragas-samples.json \
  --output .tmp/ragas-scores.json \
  --provider-config .tmp/ragas-provider-config.json
```

省略 `--output` 或传入 `-` 时，完整的 `ragas_score_batch.v3` JSON 输出到 stdout。输出只包含
每个 `case_id` 的 `scores` 和实际评分错误；缺少 reference 时不运行需要 reference 的指标，不伪造零分。

默认指标是 `faithfulness` 和 `answer_relevancy`。`faithfulness` 使用 `cited_contexts`；
`context_precision`、`context_recall` 使用 `retrieved_contexts`，且只有在样本提供 `reference`
时才适用；不使用 `context_precision_without_reference`。

## 模型配置

需要调用外部模型时，通过 `--provider-config` 指向本地 JSON 文件。该文件应是未跟踪且权限为 `0600`
的普通文件，不提交仓库，
也不使用环境变量重复保存同一凭据。

- Agent 评分使用 `eval_judge_llm`；
- RAG 评分使用 `eval_ragas_llm` 和 `eval_ragas_embedding`；
- 需要在显式检索实验中调用 Cohere Rerank 时，使用独立的 `eval_ragas_reranker`。

该文件是 Python runner 的本地输入，不是跨服务合同，也不在 `packages/contracts` 注册。字段检查以
`packages/ragas-runner/src/campus_ragas_runner/provider_config.py` 及其测试为准。

```json
{
  "profiles": {
    "eval_ragas_llm": {
      "api_key": "...",
      "base_url": "https://provider.example/v1",
      "model": "judge-model",
      "timeout_ms": 150000
    },
    "eval_ragas_embedding": {
      "api_key": "...",
      "base_url": "https://provider.example/v1",
      "model": "embedding-model",
      "timeout_ms": 150000
    },
    "eval_ragas_reranker": {
      "api_key": "...",
      "base_url": "https://reranker.example/v2",
      "model": "rerank-v4",
      "timeout_ms": 90000
    }
  }
}
```

文件不声明 `schema_version`、`provider` 或 `transport`；`rag` 评分命令的 LLM 固定使用
`openai.responses` 的 `text.format.json_schema` 结构化输出路径，不调用工具或设置 `tool_choice`；
embedding 继续使用 OpenAI-compatible embeddings 客户端。runner 为所有 OpenAI-compatible client 使用固定
的 `campus-ragas-runner/0.1` User-Agent。
`eval_ragas_reranker` 只作为离线检索实验的独立本地
provider profile，由调用方显式使用；它不从在线 Model Config 获取，也不改变
`ragas_sample_batch.v3` 的 `retrieved_contexts`。

## 手动执行产品路径

需要验证真实 Agent 行为时，手动运行 `agent-eval`。这不是在线服务、定时任务或 Ragas 输入发现
机制；它读取调用方提供的 cases 文件，通过 App API 产生目标 turn，并写出一个
`agent_product_eval_result.v3` 产品结果文件。该阶段不访问 Langfuse、不调用 Ragas。

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  agent-eval \
  --app-api-base-url <app-api-url> \
  --cookie-header '<cookie-header>' \
  --execution-control-base-url <execution-control-url> \
  --execution-control-auth-secret '<execution-control-auth-secret>' \
  --cases <cases.v1.json> \
  --output .tmp/product-result.json \
  --limit <count> \
  --json
```

`--app-api-base-url`、`--cookie-header`、`--execution-control-base-url`、
`--execution-control-auth-secret`、`--cases` 和 `--output` 是该命令的显式输入。setup turn 与目标
turn 使用同一 conversation。对话通过 App API 执行；检索上下文和工具轨迹从 execution-control 的
受认证内部投影接口按 `requestId` 读取。产品结果包含 case、`requestId`、实际答案、全部检索候选、
实际引用结果和工具轨迹，不包含 Langfuse 平台身份。

随后单独运行 Ragas 评分：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  score-ragas \
  --input .tmp/product-result.json \
  --output .tmp/eval-scores.json \
  --provider-config .tmp/ragas-provider-config.json \
  --json
```

该阶段顺序调用 Agent 和 RAG 两个官方指标 runner；空检索仍进入 Ragas 样本。结果文件只包含
`case_id`、scores 和 errors，不携带 trace 或平台身份。

最后按需发布 score：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts \
  publish-scores \
  --product-result .tmp/product-result.json \
  --scores .tmp/eval-scores.json \
  --trace-map .tmp/trace-map.json \
  --json
```

`trace-map.json` 是调用方显式准备的 `{ "case-id": "native-langfuse-trace-id" }` 映射。发布阶段用
`case_id` 关联产品结果、score 和真实 trace，并通过 SDK `score.create` 后一次 `score.flush` 写入。
Python runner 不接触 Langfuse 身份。发布失败即命令失败，不产生额外报告或数据库。

## 不支持的路径

不恢复以下已删除的形态：从普通 trace 或 Langfuse 平台状态反查正文、在 `packages/contracts` 注册
runner 配置投影、独立 score registry、持久评测报告、评测数据库或第二套 Ragas 编排器。

## 评测使用

评测结果用于定位和版本比较，不自动决定合并、发布或回滚。涉及索引时，使用
`jobs/campus-docs-index-publisher build-chunks` 的硬校验；涉及 Agent 时，使用调用方提供的 case 和
所属运行时合同测试。逐项检查无答案、空召回、禁止上下文和依据不足样本，不能用批次成功或平均分
替代失败分析。

## 相关文档

- [评测](../reference/eval.md)
- [评测用例](../reference/eval-cases.md)
- [eval-langfuse](../../packages/eval-langfuse/README.md)
- [ragas-runner](../../packages/ragas-runner/README.md)
