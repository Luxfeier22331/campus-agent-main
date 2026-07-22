# 食堂同步任务

Feishu/Lark 食堂来源同步、评价审核和 Dining schema migration 的一次性任务镜像。

## 职责

- 增量写入目录来源观测，不自动发布目录；
- 同步评价、执行文本与图片审核，并物化可公开附件；
- 处理 Ops Web 提交的评价复检；
- 为本地开发导入仓库维护的合成数据；
- 使用专用迁移凭据安装 Dining schema。

目录重建、校验、发布和回滚由 Ops Web 执行。app-api 只读取当前发布版本和公开评价。字段、来源
观测和角色权限见 `docs/data/dining.md`。

## 命令

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts sync-all
pnpm --dir jobs/dining-sync exec tsx src/cli.ts catalog-observations
pnpm --dir jobs/dining-sync exec tsx src/cli.ts run
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
pnpm --dir jobs/dining-sync exec tsx src/cli.ts migrate
pnpm --dir jobs/dining-sync exec tsx src/cli.ts import-dev-seed
```

生产镜像由 Node 24 执行 `esbuild` 打包后的 ESM，不包含 `tsx` 或运行时 TypeScript 加载器。
所有数据库命令统一读取 `PGHOST`、
`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSLMODE` 和按需的
`PGSSLROOTCERT`；`sync-all` 是 CronJob 入口，`migrate` 是部署与本地迁移入口，
`import-dev-seed` 只用于本地环境。具体执行和故障处理见 `docs/runbooks/dining.md`。

## 验证

```bash
pnpm --dir jobs/dining-sync typecheck
pnpm --dir jobs/dining-sync test
pnpm ci:dining-postgres
```

## 相关文档

- `docs/architecture/domains/dining.md`
- `docs/data/dining.md`
- `docs/runbooks/dining.md`
