# Dining Sync Job

`jobs/dining-sync` 是食堂数据写入任务，当前覆盖 Feishu/Lark catalog 同步、catalog
publish、non-production dev seed import 和 Feishu/Lark 评价来源同步。

## Boundary

它负责：

- 通过 Feishu/Lark OpenAPI 读取已授权 Base catalog 与评价记录
- 校验记录形状
- 通过 Gitee AI moderation endpoint 审核评价文本和图片
- 下载并物化可发布附件到 S3-compatible object storage
- 写入 `dining.source_observations(source_type=feishu_catalog)`
- 将 accepted catalog observations 发布到 `dining.*` catalog / release tables
- 写入 `dining.source_observations(source_type=feishu_review)`
- 从 active accepted review observations 发布 `dining.review_projections`
- 从 `packages/domains/dining` 读取 local/dev 专用 dev seed
- 在非 production 环境显式导入 dev seed 到 `dining.*` catalog / release tables

它不负责：

- 在线 `/api/dining/*` 请求处理
- app-api auth/session/conversation truth
- Operator Console 页面或命令入口
- 食堂 floorplan SVG asset truth
- raw Feishu/Lark row、file token 或临时下载 URL 的公开展示

## Runtime

本任务可以作为本地 manual command、Docker manual command、Kubernetes Job 或 Kubernetes
CronJob 运行。源码放在 `jobs/` 表示它是可部署任务 runtime，不是长驻 product app，也不是共享
package。

## Commands

```bash
pnpm --dir jobs/dining-sync typecheck
pnpm --dir jobs/dining-sync test
pnpm --dir jobs/dining-sync exec tsx ./src/cli.ts sync-all
pnpm --dir jobs/dining-sync exec tsx src/cli.ts catalog-observations
pnpm --dir jobs/dining-sync exec tsx src/cli.ts publish-catalog
pnpm --dir jobs/dining-sync exec tsx src/cli.ts publish-catalog-from-observations
pnpm --dir jobs/dining-sync exec tsx src/cli.ts import-dev-seed
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

`sync` 执行 `sync-all`，先刷新并发布 catalog，再同步评价 observation/projection。
`catalog-observations` 只写
`dining.source_observations(source_type=feishu_catalog)`，采用
`observation_id` upsert，并把本轮未再出现的旧记录标记 `stale_at`。
`publish-catalog` 会先刷新 catalog observations，再从 PG active observations
发布 catalog/release snapshot。`publish-catalog-from-observations` 不访问
Feishu/Lark，只从 PG active observations replay 发布 snapshot。
`run` 只执行评价同步，要求 PG 已有 active catalog observations，以便把评价绑定到当前
published stall/window。

`catalog-observations` / `publish-catalog` 只需要 Feishu/Lark catalog env 和
`DATABASE_URL`。`publish-catalog-from-observations` / `import-dev-seed` 只需要
`DATABASE_URL` 或 `APP_API_OPERATOR_DATABASE_URL`。`sync` / `sync-all` 需要 Feishu/Lark
review env、Postgres、object-store 和 moderation env。

`import-dev-seed` 只允许非 production 环境，用于本地重建 repo 已提交地图的
validation seed；生产环境 catalog 内容应通过 `publish-catalog` 从 Feishu/Lark
catalog source 发布。

`publish-catalog`、`publish-catalog-from-observations` 与 `import-dev-seed`
的 closeout 会输出 `visibleHalls`，用于在浏览器 smoke 前确认最新 published
snapshot 里实际可见的食堂和地图。
`verify-published` 是上线 closeout 读检查：它只读取
`dining.release_latest_pointer`、`dining.release_snapshots` 和
`dining.review_projections`，不访问 Feishu/Lark、不下载附件、不写 DB。检查内容包括
published snapshot 中可见 hall/floor/window/assignment/menu 数量、placeholder
floor 数量，以及 review image projection 中不得出现 Lark/Feishu token 或下载 URL
痕迹。

## Launch Flow

上线或 staging 验收时，dining 数据不是由 `app-api` 自动写入，也不是从浏览器或内存
fixture 读取。正确顺序是：

1. 先对目标 PG 执行 `apps/app-api` 的 shared product / dining migrations。
2. 配置生产或 staging Feishu/Lark app 凭据、目标 Base table ids 与 `DATABASE_URL`。
3. 配置 review、object-store 与 moderation env 后执行
   `pnpm --dir jobs/dining-sync exec tsx ./src/cli.ts sync-all`，刷新 catalog、落地 `feishu_review`
   observations，并写入 `dining.review_projections`。
   若只需要单独重放 catalog，执行 `publish-catalog-from-observations`，不重新访问
   Feishu/Lark。
4. 执行 `verify-published`，确认 latest published snapshot 已可读，且 review image
   projection 没有 source-provider token 泄漏。
5. 启动 `app-api` / `campus-web`，验证 `/api/dining/halls`、一个 floor route 与一个
   review route。

只有 Feishu/Lark catalog 尚未配置的 local/dev 环境，才显式执行
`import-dev-seed`。Production 不应依赖 dev seed 作为食堂内容真相。

本地 student-surface 验证不要只检查 `@campus-agent/dining/floorplans` 中是否存在 SVG。
正确入口是先显式收敛 app-api shared product migrations，再由 dining-sync job 导入
dev seed 并执行 published closeout：

```bash
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts \
  pnpm exec tsx ./scripts/bootstrap-shared-product-database.ts
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts \
  pnpm --dir jobs/dining-sync exec tsx src/cli.ts import-dev-seed
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts \
  pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

app-api 只负责自己的 shared product migrations；dining dev seed import 和
published snapshot closeout 由 `jobs/dining-sync` 负责。如果当前 worktree 没有
app-api 本地 env，应显式提供当前 checkout 的 `apps/app-api/.env`；任务脚本不会隐式读取
其他 worktree 的 env。

catalog table ids 必须显式配置：

- `DINING_LARK_CAMPUS_TABLE_ID`
- `DINING_LARK_HALL_TABLE_ID`
- `DINING_LARK_STALL_TABLE_ID`
- `DINING_LARK_DISH_TABLE_ID`

当前 source fields：

- campus table: `校区名称`, `排序`
- hall table: `食堂名称`, `所属校区`, `排序`
- stall table: `档口名称`, `所属食堂`, `排序`, `品类`
- dish table: `菜品名称`, `所属档口`, `价格`, `标签`

`价格` 允许为空；发布结果会把缺失价格写成 `NULL`，前端不展示价格 chip。
Feishu/Lark Base 关联字段可能返回 `record_id` 或 `record_ids`；当前 parser 同时支持这两种
形状。Catalog 发布 admission 只检查 source 关系和必要展示字段；占位地图不作为发布硬门槛。
当 Feishu/Lark catalog 中的食堂或档口暂时没有正式 repo floorplan scaffold 时，
`publish-catalog` 会生成显式 placeholder floor/window projection，保证窗口和菜品先进入学生端
可读快照。真正缺失食堂/档口链接或名称的记录仍会写成 blocked observation。
`campus-web` 会把这类 projection 显示为“地图待补充”，并继续允许用户点击占位地图上的档口。

审核模型配置通过 `DINING_MODERATION_*` 注入。真实
`DINING_MODERATION_API_KEY` 只允许放在本地 ignored env 或部署 Secret 中，不得写入
repo。

图片审核使用 `nsfw-classifier` 的 `image_url` 输入。任务会先把下载后的图片写入
`DINING_OBJECT_STORE_REVIEW_PREFIX` 派生出的 `-moderation` 前缀，审核通过后再复制到公开
review 前缀并删除审核对象；未通过或 provider 异常时不写入公开 projection。
公开 review 前缀中不再被 active accepted review observations 引用的图片会在发布后清理。

## Image And CronJob

`jobs/dining-sync/Dockerfile` 是 Docker/K8s manual job runtime 的构建入口。
`.github/workflows/dining-sync-image.yml` 提供手动镜像构建；默认只构建不推送，
只有 `workflow_dispatch.push_image=true` 时才推送到 GHCR，并只写入不可变的
`${GITHUB_SHA}` tag。

源仓只保留 namespace-neutral Kustomize base。部署环境仓负责 namespace、ConfigMap、
Secret、调度策略与不可变镜像选择；不得使用 `staging` 等可变 tag。CronJob 容器默认命令
是 `sync-all`；上线前可用相同镜像创建一次性 Job 跑 `verify-published` 做 closeout。
