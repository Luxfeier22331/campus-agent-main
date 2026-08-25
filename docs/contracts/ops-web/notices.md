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

列表和详情只返回通知 ID、标题、发布时间、类型、组织、外链 metadata、分类和推导状态。状态为：

- `needs_classification`：`category IS NULL`；
- `needs_publication`：已有分类且 `is_published=false`；
- `published`：`is_published=true`。

分类更新正文只接受 `{ "category": "<共享分类值>" }`，直接更新同一通知行，不增加 revision、审批、
审计历史或恢复层。已发布通知的分类保存后立即影响学生端。

## 任务

- `POST /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs/:jobName`

允许操作为 `notice-sync`、`notice-backfill`、`notice-classify-missing`、`notice-classify-one`、
`notice-publish-pending` 和 `notice-publish-one`。采集、分类和发布各自构成一个互斥操作族；已有活动 Job
时返回 `409 OPS_NOTICE_JOB_CONFLICT`。Job 固定零重试，完成 24 小时后回收，仅保留有限状态、错误和
结构化摘要，不承担长期审计。
