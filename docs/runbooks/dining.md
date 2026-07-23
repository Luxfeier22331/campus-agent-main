---
doc_type: runbook
owner_boundary: jobs/dining-sync
status: active
---
# 食堂同步与发布

## 本地开发

根目录运行 `pnpm dev:prepare`。该命令启动共享 PostgreSQL、安装 app-api schema，然后通过
`jobs/dining-sync` 的 `db:dev` 和 `seed:dev` 安装 Dining schema 与合成数据。app-api 和 Ops Web
启动时不写 seed。

地图编辑和数据库同步相互独立：

```bash
pnpm --dir packages/dining-editor floorplans:edit
pnpm --dir packages/dining-editor floorplans:generate
pnpm --dir packages/dining-editor floorplans:check
```

编辑器保存只更新 `packages/domains/dining/src/floorplans/layouts/`；生成命令才重建 manifest 和
Campus Web digest SVG。

## 部署顺序

1. 对目标 commit 运行 `packages/dining-editor` 的 `floorplans:check`。
2. 对象存储 bootstrap 创建 `campus-dining-media`，将 `public/` 设为匿名只读，并为私有
   `quarantine/` 配置一天生命周期。
3. Dining migration 单元创建 `ops_web_dining` 和 `dining_sync` DatabaseRole；共享的 `app_api`
   角色必须已经由产品数据库单元创建。
4. migration Job 使用 schema owner 执行 `db-install`：运行 Drizzle migration，然后应用并验证
   `app_api`、`dining_sync` 和 `ops_web_dining` 权限。运行时不获得 owner 凭据。
5. runtime 单元挂载严格校验的 `source.json`，并启动三个独立任务：

   | CronJob | 周期 | 命令 |
   | --- | --- | --- |
   | `dining-catalog-sync` | 每小时 | `catalog-sync` |
   | `dining-review-sync` | 每小时，错开 15 分钟 | `review-sync` |
   | `dining-review-recheck` | 每 5 分钟 | `review-recheck` |

6. 部署包含同一 floorplan manifest 的 Campus Web 与 Ops Web 版本。
7. 在 Ops Web 检查来源运行，执行 catalog rebase、validation 和 publish，再从 app-api 检查
   publication、bootstrap、楼层和 offering reviews。

CronJob 不运行 migration、开发 seed 或 catalog publish。每个任务只注入自身需要的 Lark、审核、
对象存储和数据库配置。

## 手动执行

使用与目标环境相同的挂载和环境变量，按故障面运行单一命令：

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts catalog-sync
pnpm --dir jobs/dining-sync exec tsx src/cli.ts review-sync
pnpm --dir jobs/dining-sync exec tsx src/cli.ts review-recheck
```

新的 catalog observation 不会自动改变学生端，必须经过 Ops Web rebase、validate 和 publish。

## 故障判断

- 单条 Lark 字段非法：查看 blocked observation，其他合法记录应继续同步；
- 空来源快照：本次运行失败，不把历史观测批量标记为 stale；
- moderation 或对象存储不可用：评价任务失败，不公开未审核图片；
- catalog observation 已更新但学生端未变化：在 Ops Web 执行 rebase、validate 和 publish；
- 地图区域不可用但详情正常：检查目标版本的 `floorplanId`，再运行 `floorplans:check`；
- rollback 返回地图不兼容：恢复目标 release 所需 anchor，或选择兼容 release；
- `db-install` 失败：检查 owner 连接、三类 DatabaseRole、Drizzle journal 和 Dining schema，不提升
  运行时角色；
- review revision 未变化：确认公开评价摘要是否实际变化，隐藏内容变化不递增 revision。

Secret 只存在于部署环境，不写入源码、示例或发布快照。
