---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 通知维护接口

Ops Web 提供通知安全 metadata 的查看与分类维护，并复用暂停的 CronJob 模板启动固定任务。浏览器不能
读取正文列，也不能提交任意 Kubernetes 命令、镜像、环境变量或 namespace。

## 通知

- `GET /api/ops/notices?q=&state=&category=&page=`
- `GET /api/ops/notices/:noticeId`
- `PUT /api/ops/notices/:noticeId/category`

列表和详情只返回通知 ID、标题、发布时间、类型、组织、外链 metadata、分类和推导状态。列表响应还返回
`counts`，它按当前 `q` 和 `category` 筛选统计四类数量，并忽略当前 `state` 筛选：`all`、
`needsClassification`、`needsPublication` 和 `published`。`items`、`totalItems` 和 `totalPages` 仍按当前
全部筛选条件返回。状态为：

- `needs_classification`：`category IS NULL`；
- `needs_publication`：已有分类且 `is_published=false`；
- `published`：`is_published=true`。

分类更新正文只接受 `{ "category": "<共享分类值>" }`，直接更新同一通知行。当前状态模型的消费者、
理由和重新评估条件见 `../../decisions/adr-0094-notice-maintenance-state.md`。已发布通知的分类保存后立即
影响学生端。

## 任务

- `POST /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs/:jobName`

允许操作为 `notice-sync`、`notice-backfill`、`notice-classify-missing`、`notice-classify-one`、
`notice-publish-pending` 和 `notice-publish-one`。采集、分类和发布各自构成一个互斥操作族；已有活动 Job
时返回 `409 OPS_NOTICE_JOB_CONFLICT`。Job 固定零重试，完成 24 小时后回收，不承担长期审计。单条分类和发布 Job 使用
`campus-agent.muc.wiki/notice-id` label 持久表达通知归属，任务响应通过 `noticeId` 返回该值；批量任务
以及部署前创建且没有该 label 的单条任务返回 `noticeId: null`。

每个 Job 还返回以下诊断字段：

- `processedRange`：本次 Job 实际处理的日期半开区间 `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`；
  仅采集 Job 有值，未开始、无增量或非采集 Job 时为 `null`；
- `maintenanceRange`：采集完成后通知库存维护的日期半开区间 `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`；
  只有采集 Job 能从结构化输出确认该范围时有值，其他 Job 为 `null`。失败 Job 仍可能返回本次处理区间，
  但不能据此推断维护边界已经推进；
- `progress`：最近一次结构化进度 `{ "phase": "scanning|processing|writing|finalizing",
  "processed": number, "total": number|null }`；
- `summary`：严格允许的业务摘要字段，只返回数量、`upToDate` 等已登记字段，不返回通知 ID 列表或任意日志
  对象。分类摘要使用 `classified`、`requested`、`skipped`；采集摘要使用通知、分页、来源对象和资源计数；
  发布摘要使用 `notices`、`assets`；
- `error`：应用进程从 Pod 输出的原始错误文本，包括 stack、cause、HTTP 状态和响应体，不做错误码泛化、
  脱敏或 500 字符截断；
- `controllerError`：Kubernetes Job condition 的原始 reason/message，例如
  `BackoffLimitExceeded: Job has reached the specified backoff limit`。它描述控制器观测到的结果，不能替代
  应用错误。

Ops Web 会读取成功、失败和运行中 Job 的 Pod 输出。若 Job 已失败但 Pod 输出不可用，`error` 为 `null`，
`controllerError` 仍单独返回；任务中心分别展示两者。采集的 sync 和 backfill 是两个独立 Job，页面只显示
实际创建的 Job，不自动补建或串联另一条。

任务中心的操作族为采集、分类和发布。服务端只接受上述固定操作和回填起始日期；每个操作族同时只能有一个
待运行或运行中的 Job。浏览器在提交成功等待 Kubernetes 返回期间显示一个本地 pending 行并立即锁定对应操作族；
服务端返回真实 Job 后，该行替换为真实记录。读取任务列表失败或仍在加载时不会删除 pending 行，也不会把客户端
临时行当作 Kubernetes Job 返回给其他消费者。
