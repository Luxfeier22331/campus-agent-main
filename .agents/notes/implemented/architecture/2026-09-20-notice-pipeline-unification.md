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

两个 Worker 镜像和 Kubernetes active consumer 必须一起发布，GitOps 拓扑需要包含该 consumer 才能通过 promote。旧任务 ID 仅作为类型兼容保留，自动调度和 Ops 控制面使用 `notice-pipeline`；兼容任务运行会转发到统一 Workflow，调度设置只在统一入口修改。当前验证覆盖 Worker、采集、分类、发布和 Ops Web 的 TypeScript 合同；真实 Temporal、门户和外部存储联调仍依赖部署环境。

本决定部分取代 [定时任务治理](2026-09-20-scheduled-task-governance.md) 中关于通知 CronJob 作为自动执行入口的内容；其中关于通知状态权威、处理锁、CAS、版本保护、清理和 rollback 的约束继续有效。
