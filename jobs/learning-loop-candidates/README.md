# learning-loop-candidates

从产品反馈和有界运行投影中选择评测候选，并写入 Langfuse 数据集的一次性任务。

任务只读取允许的候选字段，经过确定性去重和筛选后支持预览、发布与发布结果核对。它不训练模型、
不直接评分生产请求，也不复制完整聊天或供应商轨迹。

```bash
pnpm --dir jobs/learning-loop-candidates exec tsx src/cli.ts select-candidates --since <time>
pnpm --dir jobs/learning-loop-candidates exec tsx src/cli.ts publish-candidates --since <time> --dry-run
pnpm --dir jobs/learning-loop-candidates exec tsx src/cli.ts verify-published-candidates --since <time>
pnpm --dir jobs/learning-loop-candidates typecheck
pnpm --dir jobs/learning-loop-candidates test
```

完整数据流见 `docs/architecture/system/learning-loop.md`，评测边界见 `docs/reference/eval.md`。
