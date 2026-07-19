# transport-publisher

把已经核对的班车发布载荷写入 `campus_services` 共享读模型的一次性任务。

任务校验完整 release，在单个数据库事务中发布后供 app-api 状态页面和 execution-control 班车工具
读取。它不采集或解释原始通知，也不参与在线工具调用。

```bash
pnpm --dir jobs/transport-publisher exec tsx src/cli.ts install-schema
pnpm --dir jobs/transport-publisher exec tsx src/cli.ts publish --input <path|->
pnpm --dir jobs/transport-publisher typecheck
pnpm --dir jobs/transport-publisher test
```

领域边界和发布输入见 `docs/domains/transport.md`。
