---
doc_type: architecture
owner_boundary: domains/dining
status: active
---

# 食堂

## 文档边界

本文是 Dining 领域唯一的 canonical human design，定义产品承诺、数据来源、运行时所有权、发布
流程、地图边界和禁止恢复的旧设计。

字段级数据库参考见 `../../../data/dining.md`，学生端 HTTP 参考见
`../../../contracts/app-api/dining.md`，Ops Web 通用身份与错误合同见
`../../../contracts/ops-web.md`，重复执行步骤见 `../../../runbooks/dining.md`。

## 产品承诺

学生进入 `/dining` 后应当能够：

- 按校区和食堂切换地图；
- 在地图中快速定位档口；
- 选择档口后查看菜品和参考价格；
- 选择菜品后在地图与详情工作区下方查看评价；
- 搜索当前食堂的档口、菜品和标签。

当前不承诺营业状态、排队、库存、份量规格、菜品合并、实时售价或窗口备注。`menu item` 保留
来源中的自由名称，例如“猪脚饭”和“隆江猪脚饭”不会被系统自动合并。评价展示姓名时不添加
“同学提交”等前缀。

## 所有权

| 所有者 | 责任 |
| --- | --- |
| `packages/domains/dining` | 领域模型、校验、发布投影、dev seed、floorplan manifest 和地图生成 |
| `jobs/dining-sync` | Feishu/Lark catalog/review observations、评价审核与附件物化、数据库迁移 |
| `apps/ops-web` | catalog 草稿校正、校验、发布、回滚和评价治理；用专用角色直连 PostgreSQL |
| `apps/app-api` | 只读公开发布与评价，提供 `/api/dining/*` |
| `apps/campus-web` | 学生端地图、档口、菜品、搜索和评价体验 |

已删除的旧控制台不再承载 Dining。app-api 不提供 Dining 写接口，也不拥有 Dining schema migration。

## 数据流

```text
Feishu/Lark catalog tables
-> dining-sync hourly catalog observation sync
-> dining.source_observations
-> Ops Web rebase
-> draft + persistent operator overrides
-> validate
-> immutable release + dining.publication.catalog_release_id
-> app-api public reads
-> campus-web

Feishu/Lark review table
-> dining-sync moderation + attachment materialization
-> source observations + dining.reviews
-> dining.publication.review_revision
-> app-api review reads
-> campus-web
```

Catalog observations 不会自动发布。Ops rebase 从当前 accepted、非 stale observations 重建草稿，
然后重放 `catalog_overrides`，因此新采集不会静默覆盖人工命名、价格或档口分配。发布前必须通过
完整 draft validation。

评价每小时自动同步。submitted fields 在首次落库后不可变；后续同步只更新审核、可见性和精确
offering binding。Ops 可以隐藏、恢复、重新绑定或请求复审。恢复只允许审核为 safe 且具备
`hall -> window -> stall -> offering` 精确绑定的评价；新审核判定为违规时，旧 restore override
不能继续公开内容。

## Catalog 与发布

当前流程只有：

```text
draft -> validate -> publish
```

- draft 是可编辑 working state，包含食堂、稳定地图引用、物理窗口、档口、窗口分配、菜品和价格参考；
- release 是 immutable snapshot；
- `dining.publication` 是学生端当前选择，只保存 catalog release id、review revision 和更新时间；
- rollback 复制目标 snapshot，生成新的 release id、hash、作者和时间；
- 数据库只保留最新 30 个 catalog releases，当前 publication 永远不会被 retention 删除。

不保留 candidate、approval、schedule、`release_latest_pointer`、`release_snapshots` 或
`review_projections`。

## 来源与占位数据

Feishu/Lark 是采集入口，不是在线请求依赖。catalog 表提供校区、食堂、档口、菜品、价格和标签；
review 表提供评价原文、姓名、评分、支付价格、图片和提交时间。缺失关系、非法字段和冲突记录写成
blocked observation，不阻塞其他合法记录。

正式地图尚未覆盖的食堂或超出正式地图锚点容量的档口进入确定性的“待补充档口”地图。占位地图
用于保证 catalog 功能可用，不伪造真实位置。开发环境使用唯一的 `createDevDiningSeed`，覆盖全部
已提交地图、档口、菜品和评价；生产不消费 dev seed。

## 地图

地图布局、语义标记和生成后的静态 SVG 由仓库拥有，不属于 catalog release，也不进入对象存储：

- authored layout：`packages/domains/dining/src/floorplans/layouts/*.json`；
- generated manifest：`packages/domains/dining/src/floorplans/generated-assets.json`；
- immutable asset：`apps/campus-web/public/assets/dining/<sha256>.svg`；
- 本地编辑器：`pnpm --dir packages/domains/dining floorplans:edit`。

`floorplanId` 是数据库与应用构建之间的稳定语义引用，不随 SVG 内容变化；SHA-256 只用于应用构建
内的静态文件寻址、完整性校验和 immutable cache。数据库和 app-api 只保存或返回
`floorplan.kind`、`floorplanId` 与 `windowId <-> svgAnchorId`，不保存或返回 checksum、asset URL、
canvas、anchor inventory、窗口 geometry 或 SVG bytes。

Campus Web 使用自身构建中的轻量 manifest 把 `floorplanId` 解析为同源 SVG、digest、canvas 和 anchor
inventory。浏览器读取后再次校验同源路径、SHA-256、SVG 安全边界和 anchor 绑定。未知或不匹配的
`floorplanId` 只使地图区域 fail closed，档口、菜品和评价详情仍可使用。占位地图按已发布
`windowId` 稳定排序后在浏览器生成，不依赖数据库 geometry。

编辑器保存与静态资产生成是两个显式动作。保存只使用 source revision 乐观锁写 canonical layout，
不会生成 SVG；生成动作从全部 canonical layouts 确定性重建 manifest 和当前 digest assets。单个文件
采用原子替换，生成器会删除未跟踪且不再属于当前 manifest 的中间 SVG；已经提交的历史 digest
资产保留，由 Git 历史和应用版本管理。

正式地图的每个当前 window anchor 在新 catalog 发布时必须恰好对应一个 physical window；不存在
published binding 的 SVG 区域不可点击。地图演进先添加新 anchor，再 rebase、绑定并发布 catalog；
旧 anchor 只有在仍需支持的 release 都不再引用后才删除。rollback 会用当前应用 manifest 校验目标
snapshot，目标引用未知、已删除或重复 anchor 时返回冲突，不发布不兼容 snapshot。

学生端地图保持原始纵横比，支持按钮、滚轮和双指的连续缩放与平移。切换食堂或地图时重置视图和
本地选择。URL 只保存可分享的 `hall` 与 `floor`；窗口和菜品选择属于页面瞬时状态。

## 刷新语义

Campus Web 在页面可见时每 30 秒读取 `/api/dining/publication`：

- `catalogReleaseId` 变化：清除当前窗口/菜品选择，刷新 bootstrap、floor、search 和 reviews；
- 只有 `reviewRevision` 变化：只刷新 reviews；
- floorplan 随 Campus Web 应用版本发布；内容变化生成新的 digest URL，catalog release 不复制该 URL。

## 数据库和部署角色

| 角色/凭据 | 权限 |
| --- | --- |
| `DINING_MIGRATION_DATABASE_URL` | PreSync migration，允许重建 `dining` schema |
| `DATABASE_URL` / `dining_sync` | source observations、reviews、recheck 与 publication review revision |
| `OPS_WEB_DINING_DATABASE_URL` / `ops_web_dining` | catalog、release、override、review operations |
| `app_api` | 只读 publication、releases、reviews |

运行时角色不得获得 schema create 权限。Ops Web 的 Dining pool、TLS 和 readiness 与其观测数据库
pool 分离。Kubernetes PreSync migration 使用独立 `dining-migration-secrets`；CronJob 的
`dining-sync-secrets` 不包含 migration DSN。CronJob 每小时 `sync-all`，不会运行 migration 或
catalog publish。

## 验证

- `pnpm --dir packages/domains/dining typecheck && pnpm --dir packages/domains/dining test`
- `pnpm --dir jobs/dining-sync typecheck && pnpm --dir jobs/dining-sync test`
- `pnpm --dir apps/ops-web typecheck && pnpm --dir apps/ops-web test`
- `pnpm --dir apps/app-api typecheck && pnpm --dir apps/app-api test`
- `pnpm --dir apps/campus-web typecheck && pnpm --dir apps/campus-web test`
- `pnpm --dir apps/campus-web test:e2e:smoke`

Campus Web 食堂运行时改动执行关键浏览器 smoke；跨页面或地图交互重构在本地追加
`pnpm --dir apps/campus-web test:e2e:full`。真实同步与部署后 staging E2E 只在对应环境工作中执行。
