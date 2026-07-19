# ragas-runner

调用 Ragas 官方指标的 Python 批量评分适配器，也是 workspace 中唯一的 Python package。

runner 接收 TypeScript 编排层准备的 RAG 或 Agent 评分输入，调用 Ragas 后输出结构化 score。它不
连接 Langfuse、不选择数据集、不发布 score，也不参与在线回答。

```bash
uv run --package campus-ragas-runner python -m campus_ragas_runner rag --help
uv run --package campus-ragas-runner python -m campus_ragas_runner agent --help
pnpm --dir packages/ragas-runner test:eval
```

编排和平台交互见 `packages/eval-langfuse/README.md`，操作步骤见 `docs/runbooks/ragas.md`。
