---
doc_type: data
owner_boundary: domains/dining
status: active
---

# 食堂数据

## 边界

本文只定义 `dining.*` 的逻辑 schema、字段所有权和角色权限。领域流程和产品语义见
`../architecture/domains/dining/architecture.md`。可执行 schema 位于
`packages/domains/dining/src/schema.ts`，干净重建 migration 位于
`jobs/dining-sync/migrations/0001_dining.sql`。

当前 staging 和 production 尚未承载需要迁移的正式 Dining 数据，因此 migration 直接重建
`dining` schema，不提供兼容表、backfill 或双写。

## 表族

### Catalog draft

| 表 | 事实 |
| --- | --- |
| `halls` | 食堂标识、校区、展示名称 |
| `floors` | `floorplan_kind` 与稳定 `floorplan_id` |
| `windows` | 物理档口身份、展示字段和可空 `svg_anchor_id` |
| `stall_profiles` | 可分配到物理窗口的档口内容身份 |
| `window_assignments` | 当前窗口到档口的一对一分配 |
| `menu_items` | 不合并的自由菜品名称和标签 |
| `menu_offerings` | 某档口提供某菜品及可空价格参考 |
| `catalog_state` | 全局 draft revision、base release、更新时间和操作者 |

Catalog 表是当前 Ops draft，不是学生端直接读取面。`floorplan_kind` 只允许 `asset` 或
`placeholder`；`floorplan_id` 是稳定语义引用。数据库不保存 SVG bytes、digest、asset URL、canvas、
anchor inventory 或窗口 geometry，这些都是 Campus Web 应用版本拥有的代码资产。`windows.status`
只表达人工展示状态，不代表营业、库存或排队。

### Publication

| 表 | 事实 |
| --- | --- |
| `releases` | immutable catalog snapshot、hash、validation、作者与 rollback 关系 |
| `publication` | 当前 catalog release id、review revision 和更新时间 |

`releases.payload_json` 是学生端 data-only catalog projection truth，其中地图仍只有
`floorplan.kind`、`floorplanId` 和窗口 anchor 绑定。`predecessor_release_id` 和
`rollback_of_release_id` 只表达历史关系；rollback 必须写新 release。最多保留 30 个 release，
当前 publication 引用不删除。rollback 目标必须与当前应用内 floorplan manifest 兼容；当前地图
新增 anchor 不影响旧 release，已删除或重复的目标 anchor 会使 rollback 返回冲突。

### Source and overrides

| 表 | 事实 |
| --- | --- |
| `source_sync_runs` | 每次 Feishu/Lark catalog/review 采集的计数和结果 |
| `source_observations` | 增量 source observation、content hash、last seen run 和 stale 时间 |
| `catalog_overrides` | Ops 对名称、价格、分配和移除操作的持久覆盖 |

同一 source record 通过稳定 observation id upsert。内容变化更新 observation，当前批次未再出现的
旧记录设置 `stale_at`。rebase 只读取 accepted 且非 stale catalog observations，再重放 active
overrides。

### Reviews

| 表 | 事实 |
| --- | --- |
| `reviews` | 首次提交字段、审核状态、可见性和精确 catalog binding |
| `review_overrides` | Ops hide/restore/rebind 决策 |
| `review_recheck_requests` | 排队中的审核复检请求及结果 |

`reviews` 的 `campus`、`hall_name`、`stall_name`、`dish_name`、支付价格、评分、正文、姓名、图片和
`submitted_at` 是首次采集后不可变的 submitted fields。同步可更新：

- `moderation_status`
- `visibility`
- `hall_id`
- `stall_profile_id`
- `window_id`
- `offering_id`
- `published_at` / `updated_at`

公开评价必须同时满足：`moderation_status = safe`、`visibility = published`，且四个 binding id
完整。图片只保存审核通过后的 S3-compatible public URL，不保存 Feishu file token、临时下载 URL
或 provider payload。

### Bounded operation events

`operation_events` 保存 Dining 管理动作的低敏摘要：actor id、action、object kind/id、bounded
summary 和时间。它不保存原始评价正文副本、完整请求体或外部 trace。

## 角色权限

### Migration

`DINING_MIGRATION_DATABASE_URL` 仅供部署 PreSync migration 使用，可重建 schema 和配置 grants。
它不注入 CronJob、Ops Web 或 app-api。

### `dining_sync`

可写 source runs/observations、reviews、recheck requests 和 publication 的 review revision；可读取
当前 release、overrides 和绑定所需 catalog。不得写 catalog draft/release，不得 create schema。

### `ops_web_dining`

可读全部 Dining 表，可写 catalog、release、publication、overrides、reviews、rechecks 和 bounded
events。不得 create schema，也不使用 app-api 数据库凭据。

### `app_api`

只读 `publication`、`releases`、`reviews`。app-api Drizzle schema 只导出这三张表，不拥有 Dining
migration。

## 禁止恢复

以下表和概念已删除：

- `release_candidates`
- `release_candidate_validation_reports`
- `release_schedule_jobs`
- `release_snapshots`
- `release_latest_pointer`
- `review_projections`
- Dining audit/request payload 复制表

不要为旧代码或旧文档增加兼容视图、别名表或双写。
