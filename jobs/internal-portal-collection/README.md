# internal-portal-collection

内部门户通知与文件发布采集任务。该包提供一个本地 CLI 和一个线上 Job 入口，两者共用采集实现，
通知模式向 source bucket 写入原始来源对象，并在资源齐备后登记 `notices.*` 库存；文件发布模式只写
source bucket。

## 边界

该包是一次性任务，不提供 HTTP 服务、常驻进程或自动调度。它不持久化 TGC，不读取凭据数据库，
不运行 Temporal，不维护通用任务状态，也不清洗、分类、发布通知或解析文件发布中的 PDF。

## 本地运行

```bash
pnpm --filter notice-publisher dev:init
pnpm --filter internal-portal-collection dev:init
pnpm internal-portal:auth:pull
pnpm internal-portal:auth:check

pnpm internal-portal:collect -- --mode notice-sync
pnpm internal-portal:collect -- --mode notice-backfill \
  --start-date YYYY-MM-DD
pnpm internal-portal:collect -- --mode file-sync
```

`notice-sync` 采集当前维护区间上界之后的门户通知，`notice-backfill` 采集指定日期到当前维护下界之前的
历史通知。两种通知模式使用 [start,end) 日期区间，都会写入原始通知 JSON、正文图片和附件，并在资源
齐备后登记通知类型、组织和通知库存。`file-sync` 分页扫描
文件发布库存，逐条写入原文件和 `source.json`。已有合法对象会复用；普通文件单项失败会继续处理并使
命令最终返回非零，认证失败会直接终止。

首次建立通知维护状态时，先运行 `notice-backfill --start-date 2025-12-01`；没有完整 v3 区间时，
`notice-sync` 会拒绝运行。同步和回填通过 PostgreSQL advisory lock 串行执行，失败不会推进 `_state.json`。
门户列表日期参数的闭区间语义由适配器转换，详情发布时间会做最终半开区间校验。

`notice-publisher dev:init` 先安装当前 worktree 的通知 schema；采集器本地入口读取自身 `dev:init` 管理的
`.env.local`，其中包含通知数据库、对象存储配置和最近一次 `internal-portal:auth:pull` 取得的 TGC。

## 线上 Job

Kubernetes base 提供三个默认暂停的 CronJob，每个模板固定一种采集动作。线上操作只依赖 `kubectl`：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-sync <job-name>

kubectl -n <namespace> create job \
  --from=cronjob/notice-backfill <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  INTERNAL_PORTAL_NOTICE_START_DATE=YYYY-MM-DD -o yaml |
kubectl -n <namespace> create -f -

kubectl -n <namespace> create job \
  --from=cronjob/file-sync <job-name>
```

Job 入口通过 `OPS_WEB_INTERNAL_URL` 调用 Ops Web 解析第一条可用 TGC，只在当前进程内使用；采集会话
可能取得的新 TGC 也不会回写凭据池。通知增量与回填使用既有数据库 owner 连接登记库存；文件发布模式
不访问通知数据库。通知 Job 输出有效维护区间和 scanning/processing/writing/finalizing 结构化进度，
最终结果不输出完整通知 ID 列表；错误输出保留原始异常、stack、cause、HTTP 状态和响应体。

## 验证

```bash
pnpm --filter internal-portal-collection typecheck
pnpm --filter internal-portal-collection test
pnpm --filter internal-portal-collection build
```
