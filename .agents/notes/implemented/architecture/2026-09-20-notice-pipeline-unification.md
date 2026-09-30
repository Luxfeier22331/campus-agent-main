# Agent Note: 通知采集到 RAG 的统一 Temporal 流水线

Status: implemented

## 背景

通知采集、分类、发布和通知索引刷新此前由 Kubernetes CronJob、独立 Job 和一个只负责 RAG 的 Temporal Worker 分开维护。这样导致调度入口、任务展示、失败处理和发布拓扑不一致；RAG Worker 的命名也掩盖了它实际承担的维护编排职责。

## 决策

通知流水线由 `notice-pipeline-worker` 统一承载，使用 `notice-pipeline` Temporal task queue 和 `notice-pipeline` Schedule；通知制品生成、Embedding、RAG 发布、清理和 rollback 由独立的 `notice-artifacts-worker` 使用 `notice-artifacts` task queue 承载。主 Workflow 按采集、分类、发布、通知制品、RAG 刷新、清理顺序执行；已有 Job 包继续提供 activity 实现与手动恢复入口。文件同步也通过 pipeline 的 `file-sync` mode 进入同一 Workflow。默认 Schedule 为 15 分钟且首次暂停，可由 Ops 任务中心调整为 15、30 或 60 分钟。

单条通知失败继续处理并沿用现有 `processing_failures`，门户、数据库、对象存储、模型或 Qdrant 等阶段级基础设施失败阻断后续阶段。索引目录的锁、CAS、版本保护和清理规则继续由现有 RAG 实现负责，不新增独立 run ledger。Ops 任务中心以 `notice-pipeline` 作为统一调度和运行查询入口；旧 Kubernetes 通知 CronJob 不再作为自动链路。

## 未采用方案

保留三个独立 CronJob 会继续复制调度和状态合同，并且无法保证采集、分类、发布与 RAG 刷新的阶段边界一致。把所有逻辑复制进 Worker 会绕开已有锁、失败记录和发布合同，因此只在 Activity 层复用既有实现。增加独立运行账本会产生第二套状态权威，当前 Temporal history、通知失败表和 RAG catalog 已满足消费方需要。

## 后果

两个 Worker 镜像和 Kubernetes active consumer 必须一起发布，GitOps 拓扑需要包含该 consumer 才能通过 promote。自动调度和 Ops 控制面只使用 `notice-pipeline`；`/tasks` 不再列出采集、分类、发布三个兼容任务，旧任务 ID 的调度、运行与详情接口返回 404。单项操作及其历史继续由通知维护页和现有 Temporal adapter 承担。`notice-artifacts-worker` 的 Embedding 阶段直接调用外部模型 provider，其 Egress NetworkPolicy 必须保留集群外 443 出口（与 `campus-docs-embedding-builder-egress` 同边界）；2026-09 复核时补回了拆分时丢失的该规则。当前验证覆盖 Worker、采集、分类、发布和 Ops Web 的 TypeScript 合同；真实 Temporal、门户和外部存储联调仍依赖部署环境。

2026-09 复核补齐了 notice-publisher 通知资产 `createOrVerifyDerived` 的并发收敛：`IfNoneMatch` 写入遇到 412 时重读对象并比对 digest，同内容视为成功、不同内容才报冲突，与其余三个 index publisher 的 immutable 写入模式一致；此前该路径会把并发同内容写入的 412 裸抛为发布失败。

2026-09-27 复核（#553）：`createNoticeAutomationService`（`apps/ops-web/src/server/notice-automation.ts`）自统一迁移移除 `tasks.ts` 的 `notice-sync` 调度分支后已无生产调用方，仅测试注入可达，其 CronJob patch 分支对应的 `GET/PUT /api/ops/notices/automation` 路由更早已删除。runbook 与合同文档已按 `notice-pipeline` Schedule 所有权改写（ingestion、notice-indexing、temporal、k8s-runtime、ops-web notices 合同与 README），删除 GitOps 忽略 `suspend`/`schedule` 的上线流程；同批修正 ops-web 合同 README 班车清单——其自 #429 起登记的 `schedule-sets`/`point-periods`/`exceptions`/`claims` 端点从未实现，实际存在的只有 `routes`、`schedule-periods` 及通知关联端点。2026-09-30 完成退役：通知维护页已通过 Temporal adapter 读取任务历史，删除该 service、旧 automation 合同、`app.ts` 注入和 `createTaskService` 的 `collection` 参数，并移除 `/tasks` 兼容任务条目及其专属失败计数投影；失败分类仍在通知维护页处理。该次复核保留了 CronJob 模板来源的旧描述；2026-09-29 在线恢复确认模板已删除，通知维护接口仍读取模板，现已改为 Temporal adapter。

本决定部分取代 [定时任务治理](2026-09-20-scheduled-task-governance.md) 中关于通知 CronJob 作为自动执行入口的内容；其中关于通知状态权威、处理锁、CAS、版本保护、清理和 rollback 的约束继续有效。

2026-09-29 修复通知维护接口：八种 operation 映射到既有 Workflow，`jobName` 使用 Temporal runId，
创建使用共享 workflowId 的原子冲突策略，运行详情固定 runId 且 `followRuns: false`。保留既有 HTTP
响应字段，状态、进度和摘要从 Temporal history/heartbeat/result 投影，不新增账本。当时兼容任务改为展示同一
Schedule，停止查询已删除的 CronJob；这些重复入口现已退役。采集的结构化结果与 CLI exit code 分开，单条失败保持 partial 并
继续下游；阶段级异常仍失败。分类/发布 Activity 复用已有数据库处理锁，重发布调用 `republishNotices`。
Workflow 汇总 partial，清理失败保留已发布索引且返回 partial，取消继续传播。

任务目录仍保留具有部署定义的 OCR 和门户凭据检查，调度和执行均只读，不再显示后端必定拒绝的运行按钮。通知流水线在本地和部署环境均使用同一 Temporal 运行入口。任务服务、API 和页面回归覆盖当前目录、旧 ID 的 404、只读能力以及统一流水线的调度、运行和回滚。
