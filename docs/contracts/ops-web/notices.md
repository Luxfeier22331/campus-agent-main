---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 通知维护接口

Ops Web 提供通知摘要、已采集正文预览、分类维护和一次性维护任务，并复用 CronJob 模板启动固定任务。浏览器不能
提交任意 Kubernetes 命令、镜像、环境变量或 namespace。

## 通知

- `GET /api/ops/notices?q=&state=&category=&page=`
- `GET /api/ops/notices/:noticeId`
- `PUT /api/ops/notices/:noticeId/category`

### 正文预览

- `GET /api/ops/notices/:noticeId/preview`
- `GET /api/ops/notices/:noticeId/images/:ordinal`
- `GET /api/ops/notices/:noticeId/attachments/:ordinal`

预览统一读取 source bucket 中已采集的通知，使用与 publisher 相同的正文规范化逻辑；不读取或写入发布投影，
不触发发布、采集或 OCR。已发布、未分类及待发布通知均可由已登录运营人员预览。响应包含 `noticeId`、
`contentHtml`、`isExternal`、`externalUrl`、`images`（展示序号和 Ops URL）、`attachments`（来源序号、名称、后缀和 Ops URL）。
外链通知只提供原始链接，不抓取外部正文。

图片接口按展示序号映射 source ordinal，附件按来源序号定位；客户端不能指定对象 key 或任意 URL。
资源按需从对象存储流式读取，图片及 PDF 支持浏览器查看，其他附件下载。列表预览不逐个下载或探测附件。
空正文不隐藏附件；来源或附件 404 与存储不可用分别返回错误，不通过发布内容回退。

详情默认打开「正文」页签，「维护」保留来源信息、分类、发布及 OCR 识别结果。页签切换保留分类草稿，
切换通知沿用未保存提醒。正文查询按通知 ID 隔离，沿用 Ops 查询策略，不轮询、不复用上一条通知作为占位。
正文内显示图片和附件数量；维护页的「可识别资源」数量不代表已有识别结果，也不触发提前读取 OCR。
图片失败时可单独重试，重试不重新请求正文或其他资源。移动端保留顶部关闭入口，关闭后返回通知队列焦点。

### 班车关联

- `GET /api/ops/notices/:noticeId/transport-schedule-periods` 返回通知关联的班车时间段，供通知详情查看并跳转到
  Ops 排班编辑器；响应包含线路、有效日期、星期、运行状态和关联说明。
- 排班时间段使用 `GET/PUT /api/ops/transport/schedule-periods/:scheduleId/notices` 读取或替换关联通知，关联输入为
  `{ "noticeLinks": [{ "noticeId": number, "summary": string|null }] }`。同一时间段内通知不可重复，最多 100 条。
- 新建时间段可以在创建请求中携带同样的 `noticeLinks`，与时间段及班次明细原子保存；复制、范围套用和单班次快捷调整
  不自动复制通知关联。编辑已有时间段保留原关联；关联独立保存不改时间段更新时间，但最新已发布通知的发布时间
  参与时间段选择，保存后刷新排班数据、月历与影响预览。

### 摘要与分类

列表和详情只返回通知 ID、标题、发布时间、类型、组织、外链 metadata、分类和推导状态。列表响应还返回
`counts`，它按当前 `q` 和 `category` 筛选统计四类数量，并忽略当前 `state` 筛选：`all`、
`needsClassification`、`needsPublication` 和 `published`。`items`、`totalItems` 和 `totalPages` 仍按当前
全部筛选条件返回。状态为：

- `needs_classification`：`category IS NULL`；
- `needs_publication`：已有分类且 `is_published=false`；
- `published`：`is_published=true`。

分类更新正文只接受 `{ "category": "<共享分类值>" }`，直接更新同一通知行。当前状态模型的消费者、
理由和重新评估条件见 [通知维护状态收敛](../../../.agents/notes/implemented/architecture/2026-08-25-notice-maintenance-state.md)。已发布通知的分类保存后立即
影响学生端。

## 自动化调度

- 自动化链路是 Temporal Schedule `notice-pipeline`，由 `notice-pipeline-worker` 部署时创建，默认
  暂停、周期 15 分钟，可调整为 30 或 60 分钟；启停与周期通过任务页 `/api/ops/tasks` 修改，通知维护页
  不再提供自动采集配置。
- 历史 `GET/PUT /api/ops/notices/automation` 入口已随统一流水线迁移移除；CronJob 不再承载自动调度，
  保持 GitOps 管理的暂停模板，仅作为一次性 Job 的模板来源，运行时也不 patch 其 `suspend`/`schedule`。
- 任务列表在活动任务期间每 3 秒、空闲时每 30 秒刷新；后台标签页不轮询，回到页面重新读取。

## 任务操作

- `POST /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs/:jobName`

允许操作为 `notice-sync`、`notice-backfill`、`notice-rescan`、`notice-classify-missing`、`notice-classify-one`、
`notice-publish-pending`、`notice-publish-one` 和 `notice-republish-one`。采集、分类和发布各自构成一个互斥操作族；已有活动 Job
时返回 `409 OPS_NOTICE_JOB_CONFLICT`。Job 固定零重试，完成 24 小时后回收，不承担长期审计。单条分类和发布 Job 使用
`campus-agent.muc.wiki/notice-id` label 持久表达通知归属，任务响应通过 `noticeId` 返回该值；批量任务
以及部署前创建且没有该 label 的单条任务返回 `noticeId: null`。

列表包含 Ops 创建与手动恢复的任务，以 `trigger: manual|scheduled` 区分（CronJob 模板保持暂停，
正常不产生 `scheduled` 任务）；只返回最近 50 条，
互斥检查覆盖全部仍保留的任务，不受展示数量限制。`notice-rescan` 接受 `{ from, to }` 半开区间，
复用采集模板和数据库锁；仅补已有维护范围内缺少的通知，不刷新旧详情、不推进维护边界。
页面日期结束值包含当天，提交时转换成次日排他上界。分类与发布的自动执行由 `notice-pipeline` 统一
编排，OCR 不参与自动调度。

部署环境从固定 CronJob 模板创建 Kubernetes Job。`local/development` 使用相同接口和任务状态启动
当前 worktree 的固定采集、分类或发布 CLI（采集使用其本地 adapter 入口加载自身环境）；本地任务只保存在 Ops Web 进程内，服务重启后消失。两种
执行方式都不接受浏览器提交 command、环境变量或执行路径，也不在失败后切换到另一种执行方式。

`notice-republish-one` 只用于已发布的站内通知，重新读取 source bucket 并更新正文投影，保持已发布状态和分类不变；
后台不提供批量重新发布入口，批量更新由 notice-publisher 运维命令显式执行。

每个 Job 还返回以下诊断字段：

- `processedRange`：本次 Job 实际处理的日期半开区间 `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`；
  仅采集 Job 有值，未开始、没有执行扫描或非采集 Job 时为 `null`；同日同步即使没有新增通知仍有扫描区间；
- `maintenanceRange`：采集完成后通知库存维护的日期半开区间 `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`；
  只有采集 Job 能从结构化输出确认该范围时有值，其他 Job 为 `null`。失败 Job 仍可能返回本次处理区间，
  但不能据此推断维护边界已经推进；
- `progress`：最近一次结构化进度 `{ "phase": "scanning|processing|writing|finalizing",
  "processed": number, "total": number|null }`；
- `summary`：严格允许的业务摘要字段，只返回数量、`upToDate` 等已登记字段，不返回通知 ID 列表或任意日志
  对象。分类摘要使用 `classified`、`requested`、`skipped`；采集摘要使用通知、分页、来源对象和资源计数，资源计数
  可包含 `attachmentsMissing`，表示门户明确返回 HTTP 404 且未创建资源对象的通知附件数量；
  `noticesAdded` 为本轮新登记数，`upToDate=true` 显示为「本轮无新增通知」；
  首次发布摘要使用 `notices`、`assets`，重新发布还可使用 `updated`、`unchanged`；
- `error`：应用进程从 Pod 或本地子进程输出的原始错误文本，包括 stack、cause、HTTP 状态和响应体，不做错误码泛化、
  脱敏或 500 字符截断；
- `controllerError`：Kubernetes Job condition 的原始 reason/message，例如
  `BackoffLimitExceeded: Job has reached the specified backoff limit`。它描述控制器观测到的结果，不能替代
  应用错误。

Ops Web 会读取成功、失败和运行中 Job 的进程输出。若 Kubernetes Job 已失败但 Pod 输出不可用，`error` 为 `null`，
`controllerError` 仍单独返回；任务中心分别展示两者。采集的 sync、backfill 和 rescan 是独立 Job，页面只显示
实际创建的 Job，不自动补建或串联另一条。

任务中心的操作族为采集、分类和发布。服务端只接受上述固定操作、回填起始日期或补查范围；每个操作族同时只能有一个
待运行或运行中的 Job。浏览器在提交成功等待 Kubernetes 返回期间显示一个本地 pending 行并立即锁定对应操作族；
服务端返回真实 Job 后，该行替换为真实记录。读取任务列表失败或仍在加载时不会删除 pending 行，也不会把客户端
临时行当作 Kubernetes Job 返回给其他消费者。
