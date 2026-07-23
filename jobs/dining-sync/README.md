# 食堂同步任务

`jobs/dining-sync` 负责 Feishu/Lark 食堂来源同步、评价审核、公开附件物化、评价复检和
Dining 数据库安装。目录重建、校验、发布和回滚由 Ops Web 执行；app-api 只读取当前发布版本和
公开评价。

## 正式命令

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts catalog-sync
pnpm --dir jobs/dining-sync exec tsx src/cli.ts review-sync
pnpm --dir jobs/dining-sync exec tsx src/cli.ts review-recheck
pnpm --dir jobs/dining-sync exec tsx src/cli.ts db-install
```

- `catalog-sync`：采集目录表并增量写入来源观测，不自动发布；
- `review-sync`：采集评价，执行文本与图片审核，把安全图片从 `quarantine/` 发布到 `public/`；
- `review-recheck`：处理 Ops Web 创建的评价复检请求；
- `db-install`：使用 Drizzle 安装 schema，再应用并验证 `app_api`、`dining_sync` 和
  `ops_web_dining` 权限。

生产镜像由 Node 24 运行打包后的 ESM，不包含 `tsx`。三个同步命令由独立 CronJob 调用，镜像没有
隐式默认任务。

## 配置

数据库统一读取 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSLMODE` 和
按需的 `PGSSLROOTCERT`。目录与评价来源从
`/etc/campus-agent/dining/source.json` 读取，并由严格的 Zod schema 校验。

`catalog-sync` 额外需要 Lark app secret；`review-sync` 还需要审核服务和 S3-compatible 对象存储
凭据；`review-recheck` 只需要数据库与审核服务配置。bucket 和对象 key 合同由代码固定，不通过
环境变量改变。

本地 schema 和合成数据分别使用 `pnpm --dir jobs/dining-sync db:dev` 与
`pnpm --dir jobs/dining-sync seed:dev`，不属于生产 CLI。

## 验证

```bash
pnpm --dir jobs/dining-sync typecheck
pnpm --dir jobs/dining-sync test
pnpm ci:dining-postgres
```

字段、来源观测和角色权限见 `docs/data/dining.md`，部署与故障处理见
`docs/runbooks/dining.md`。
