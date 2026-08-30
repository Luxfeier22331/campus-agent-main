# 通知发布器

`notice-publisher` 清洗已经登记且已有分类的通知，校验 source 资源，并在一个数据库事务中写入正文、
资源 metadata 和发布状态。图片写入 derived bucket，附件字节保留在 source bucket；该包不负责采集
或分类。

## 入口

- `src/cli.ts`：schema migration、通知发布和附件链接回填入口；
- `src/publisher.ts`：来源校验、清洗与发布流程；
- `src/migrate.ts`：`notices.*` schema migration 的历史入口。

```bash
pnpm dev:shared-reconcile
pnpm dev:init -- --target notice-publisher
pnpm --filter notice-publisher publish
pnpm --filter notice-publisher publish -- --notice-id 123456
```

通知 schema 与授权由 `campus-agent-schema` 安装。`pnpm dev:init -- --target notice-publisher` 在生成托管 `.env.local` 后调用
`seed-local`，后者只向隔离的本地数据库写入通知分类，不创建表，也不维护 migration ledger。
`migrate` 和 `migrations/` 暂作为现有部署数据库的不可变历史入口保留，不参与新的本地 bootstrap。

显式指定已发布通知时会重新校验来源正文和资源；来源 metadata 或已发布内容冲突时失败。外链通知只
发布来源 metadata 和 URL。图片写入 derived bucket，附件字节继续保留在 source bucket。

## 相关文档

- 操作步骤与故障排查：`docs/runbooks/ingestion.md`
- 通知数据布局：`docs/data/notices.md`
- 通知领域边界：`docs/architecture/domains/notices.md`
