# ragas-runner

调用 Ragas 官方指标的 Python 批量评分适配器，也是 workspace 中唯一的 Python package。

RAG runner 接收 `ragas_sample_batch.v2`，调用 Ragas 后输出 `ragas_score_batch.v2`。样本只包含
Ragas 所需的用户问题、答案、检索文本、可选 reference 和标量 metadata；空
`retrieved_contexts` 也会被评分。Agent runner 使用独立的 `ragas_agent_sample_batch.v2` 合同，
仅服务工具轨迹指标。

runner 不连接 Langfuse、不选择数据集、不从 trace 读取正文、不发布 score，也不参与在线回答。平台
身份和 score 目标由上层 TypeScript 适配器在需要发布时补回。

`--provider-config` 读取 runner 本地 JSON 文件。该文件只为本次离线评测提供 `profiles`；每个 profile
只包含 `api_key`、可选 `base_url`、`model` 和 `timeout_ms`。支持的 profile 包括
`eval_judge_llm`、`eval_ragas_llm`、`eval_ragas_embedding` 和独立的
`eval_ragas_reranker`。它不是跨服务合同，也不由 `packages/contracts` 注册。

`rag` 评分命令只使用 `eval_ragas_llm` 和 `eval_ragas_embedding` 调用 Ragas 官方指标。LLM 评分固定
使用 `openai.responses` 的 `text.format.json_schema` 结构化输出路径，不调用工具或设置 `tool_choice`；
embedding 继续使用 OpenAI-compatible embeddings 接口。
需要在检索实验中显式调用 Cohere Rerank 的调用方可以复用同一文件中的 `eval_ragas_reranker`；该配置
不会被自动解析为在线 Model Config 的 `campus_docs_reranker`，也不会改变 native Ragas 样本的最终
`retrieved_contexts`。

```bash
uv run --package campus-ragas-runner python -m campus_ragas_runner rag --help
uv run --package campus-ragas-runner python -m campus_ragas_runner agent --help
pnpm --dir packages/ragas-runner test:eval
```

输入合同、模型配置和操作步骤见 `docs/runbooks/ragas.md`；产品路径和 Langfuse 适配见
`packages/eval-langfuse/README.md`。
