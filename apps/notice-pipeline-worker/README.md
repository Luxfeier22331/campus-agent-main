# 通知流水线 Worker

Temporal 队列 `notice-pipeline` 负责通知采集、分类、正文发布及现有单项维护操作。
Schedule 默认周期 15 分钟，首次创建暂停；Ops `/tasks` 支持 15、30、60 分钟、立即运行和暂停。
定时入口通过固定 ID 子工作流与手动操作互斥。暂停调度不会取消已运行的任务。

本 Worker 不构建 Chunk/Embedding，不修改 Qdrant，也不承担索引清理和回滚。
通知发布成功与进入检索索引是两个独立结果；运维显式运行
[retrieval-index Job](../../jobs/retrieval-index/README.md) 后检索内容才更新。

```bash
pnpm dev:init -- --target notice-pipeline-worker
pnpm --filter notice-pipeline-worker dev
pnpm --filter notice-pipeline-worker test:unit
```

镜像中的 `dist/schedule-cli.js` 初始化调度，更新工作流和重叠策略，同时保留操作员设置的周期和启停。
单条通知失败继续处理并汇总 partial；阶段级失败阻断后续步骤。

边界见[通知领域](../../docs/architecture/domains/notices.md)与
[检索职责调整](../../.agents/notes/implemented/architecture/2026-10-14-retrieval-index-jobs.md)。
