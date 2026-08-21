# ragas-runner

调用 Ragas 官方指标的 Python 批量评分适配器，也是 workspace 中唯一的 Python package。

RAG runner 接收 `ragas_sample_batch.v2`，调用 Ragas 后输出 `ragas_score_batch.v2`。样本只包含
Ragas 所需的用户问题、答案、检索文本、可选 reference 和标量 metadata；空
`retrieved_contexts` 也会被评分。Agent runner 使用独立的 `ragas_agent_sample_batch.v2` 合同，
仅服务工具轨迹指标。

runner 不连接 Langfuse、不选择数据集、不从 trace 读取正文、不发布 score，也不参与在线回答。平台
身份和 score 目标由上层 TypeScript 适配器在需要发布时补回。

`--provider-config` 读取 runner 本地 JSON 文件。该文件只为本次离线评分提供 `profiles`；每个 profile
只包含 `api_key`、可选 `base_url`、`model` 和 `timeout_ms`。它不是跨服务合同，也不由
`packages/contracts` 注册。

```bash
uv run --package campus-ragas-runner python -m campus_ragas_runner rag --help
uv run --package campus-ragas-runner python -m campus_ragas_runner agent --help
pnpm --dir packages/ragas-runner test:eval
```

输入合同、模型配置和操作步骤见 `docs/runbooks/ragas.md`；产品路径和 Langfuse 适配见
`packages/eval-langfuse/README.md`。
