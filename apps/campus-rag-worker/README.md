# Campus RAG 离线刷新 Worker

独立 Temporal 队列 `campus-rag` 每小时刷新已发布通知的索引；沿用当前索引中的 Docs Embedding Set。
工作流只传递引用、计数和结果，实际构建由 Notice 与 Campus RAG publisher 的公开接口执行。

首次调度创建暂停。`schedule:init` 更新部署拥有的工作流和重叠策略，保留操作员设置的启停和周期。
Ops `/tasks` 支持 15、30、60 分钟、立即运行和暂停。暂停不取消运行中的工作流。
手动运行也通过同一 Schedule，显式使用 SKIP。Docs 发布继续使用显式制品输入。

## 本地运行

```bash
pnpm dev:init -- --target ops-web
pnpm dev:init -- --target campus-rag-worker
pnpm dev:doctor -- --target campus-rag-worker
pnpm --filter campus-rag-worker dev
```

本地使用 worktree 数据库、derived bucket 和 Temporal namespace，初始化不调用 embedding provider。
构建出的 `dist/worker.js` 使用预先打包的工作流；镜像入口可用 `dist/schedule-cli.js` 初始化调度。

## 发布与恢复

当前索引必须登记真实 Docs、Notice Embedding Set，并经过 publisher 校验；没有引用时刷新失败，
不会自动猜测或写入空引用。所有发布登记候选后才创建 collection，验证后以预期当前值激活。
未激活且未验证的中断候选可在 publisher 锁下重建，已验证或受保护的 collection 不自动修复。

保留当前与上一版本。其他自动版本退出保护至少一小时后清理 collection；对象仅限自动生产者标记、
没有保留版本引用且生产工作流已结束的对象；删除全部对象版本并确认清理后才移除版本记录。未完成对象还须超过 24 小时。共享 embedding cache、
来源资产和手动产物保留。清理失败不撤销已成功的激活，下次刷新继续清理。

回滚先暂停 Schedule，等待活动刷新结束后使用同一 publisher 激活已验证上一版本，之后保持暂停。
维护旧制品前也须暂停并等待刷新结束。

决策与验收范围见 [定时任务治理](../../.agents/notes/implemented/architecture/2026-09-20-scheduled-task-governance.md)。
