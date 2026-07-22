---
doc_type: runbook
owner_boundary: jobs/dining-sync
status: active
---
# 食堂同步与发布

## 本地开发

根目录执行：

```bash
pnpm dev:prepare
```

该命令启动共享 PostgreSQL、安装 app-api schema，然后使用本地 `PG*` 变量显式执行 Dining
`migrate` 和 `import-dev-seed`。dev seed 是本地唯一合成食堂数据；app-api 和 Ops Web 启动时不得写 seed。

地图编辑和数据库同步相互独立。启动学生端前验证仓库地图资产：

```bash
pnpm --dir packages/domains/dining floorplans:check
```

## 部署顺序

1. 对目标 commit 运行 floorplan check，确认 canonical layout、generated manifest 和 Campus Web
   静态 SVG 一致。
2. 从 `infra/k8s/dining-sync/migration` 使用目标 dining-sync image 运行低 wave 的 Argo CD
   `Sync` migration Job；需要定时采集时，同一发布 Application 还必须选择
   `infra/k8s/dining-sync/runtime`，并提供独立同步角色和来源凭据。源码清单存在不表示环境已启用
   CronJob。
3. migration Job 只使用环境拥有的 schema owner 连接，不向同步任务或应用下发该凭据。
4. 已启用 CronJob 时确认它使用 `dining_sync`；Ops Web 使用 `ops_web_dining`，app-api 使用只读
   `app_api` 角色。
5. 部署包含同一 floorplan manifest 的 Campus Web 与 Ops Web 版本。
6. 启动每小时 Dining CronJob，命令为 `sync-all`。
7. 在 Ops Web 查看来源观测，执行 catalog rebase、validation 和 publish。
8. 执行 `verify-published`，再检查 publication、bootstrap、一个 floor 和一个 offering review。

CronJob 不运行 migration、dev seed 或 catalog publish。

## 手动同步

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts sync-all
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

只排查目录来源时运行 `catalog-observations`；只同步评价和处理复检时运行 `run`。新 catalog
observation 不会自动改变学生端，必须经过 Ops Web rebase、validate 和 publish。

## 地图编辑与发布

```bash
pnpm --dir packages/domains/dining floorplans:edit
pnpm --dir packages/domains/dining floorplans:generate
pnpm --dir packages/domains/dining floorplans:check
```

编辑器“保存”只原子更新 canonical layout，并校验 source revision；“生成静态地图”才重建 manifest
和 digest SVG。数据库只保存稳定 `floorplanId` 与 anchor binding，不补写 URL、SHA、canvas 或
geometry。

## 故障判断

- 单条飞书字段非法：查看 blocked observation，其他合法记录应继续同步。
- moderation 或对象存储不可用：任务失败关闭，不公开未审核评价。
- catalog observation 已更新但学生端未变化：在 Ops Web 执行 rebase、validate 和 publish。
- 地图区域不可用但详情正常：检查 Campus Web 构建是否包含对应 `floorplanId`，再运行
  `floorplans:check`。
- rollback 返回地图不兼容：恢复目标 release 需要的 anchor，或选择仍兼容的 release；不得绕过
  manifest 校验。
- migration 权限失败：检查 migration Job 的 `PGUSER`、`PGPASSWORD` 与 DatabaseRole，不提升
  `dining_sync`、`ops_web_dining` 或
  `app_api` 运行时角色。
- review revision 未变化：确认公开评价摘要是否实际变化；隐藏内容变化不应递增 revision。

Secret 只存在于环境仓或部署 Secret，不写入源码、example 或发布快照。
