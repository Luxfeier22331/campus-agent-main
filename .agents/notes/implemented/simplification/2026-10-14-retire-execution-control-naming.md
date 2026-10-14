# Agent Note: 清理 Execution Control 历史命名

Status: implemented

## 背景

旧 execution-control 编排架构已经退役，但运行合同仍把当前 Agent Control 暴露为
`ExecutionControl`：环境变量、App API 适配器、工具 registry、错误码、Ops 诊断和 PostgreSQL
schema/role 都继续使用历史身份。HTTP 路径已经迁移到 `/internal/agent/runs/...`，其余命名仍会
让调用方误判当前 owner，也阻碍 Inspect 直接接入 Agent Control。

## 决策

当前运行链路统一使用 Agent Control 命名：代码类型和模块、`AGENT_CONTROL_*` 配置、工具
`agent_control_internal_query`、`agent_control_*` 错误码、Ops 的 `agent_control_release` 和
PostgreSQL `agent_control` schema/role。工具 registry 升级到 v8；旧 v6/v7 schema 只保留为历史
合同，不再作为当前输入接受。

数据库迁移原位重命名 schema，保留表、行、索引、view、外键和历史 migration 不变。运行 role 采用
分阶段切换：环境 owner 先预置 `agent_control`，暂停并排空仍使用旧 schema/合同的消费者，迁移期间保留
`execution_control`，schema Job 完成 rename 后再启动或滚动新消费者，最后由独立发布退役旧 role 和 Secret。
应用迁移只负责 schema 名称和当前 ACL。
生产不保留旧配置、错误码、handler 或双读别名；历史数据、Temporal history、旧日志和已应用 migration
不回写。

内部凭据按当前 owner 命名：Control 与 Runtime 使用 `agent-control-runtime-secrets`，App API 输入读取
和产品回调共用 `app-api-internal-secrets/APP_API_INTERNAL_SHARED_SECRET`，Memory owner salt 合并到
`memory-service-secrets`。名称变更保留凭据原值和认证 header，不拆分新权限边界。Qdrant CA 使用
`campus-agent-qdrant-tls-ca`，不再归属于已拆分的执行面聚合。

GitOps 同步删除无消费者的 Provider Config bootstrap Secret、旧 admin selector，以及已失去 producer
和扩缩容消费者的 execution-worker scrape、recording rules、runtime-metrics 和 KEDA。固定副本行为不变。

schema/role 切换由维护窗口的 Kargo Promotion 驱动：数据库 Application 先创建 `agent_control`，
迁移 Job 检查 durable run、Memory operation、Temporal workflow 和旧连接排空后再 rename；旧 role
在新消费者验证完成前保留。执行相关接口使用临时维护包装层，其他 App API 路由继续可用；不通过维护者
手工 `kubectl apply` 或 SQL 把角色和迁移从 GitOps 流程中拆开。
数据库角色归 data-postgres base，与 schema Job 形成角色先就绪、迁移后执行的顺序。维护包装层只用于
GitOps 上传的临时 App API 版本：排空时保留回调、查询和取消，冻结时停止执行相关入口及后台派发；
恢复时回到候选的正常版本。Ops 排空期间关闭外部入口但保留内部凭据解析，避免阻塞在途 Notice
任务；冻结消费者后再 rename。Schedule 原有暂停状态由维护 Job 保存和恢复，不自动启用原本停用的任务。

## 未采用方案

- 保留 `EXECUTION_CONTROL_*` 和旧错误码作为长期别名会继续暴露退役架构名称，并使新消费者无法确认
  当前 owner，因此不采用。
- 复制整套数据库表到新 schema 会制造双写、数据校验和回滚状态；原位 schema rename 能保留对象身份
  与数据，因此不采用复制迁移。
- 修改已应用的 baseline migration 或历史决策记录会破坏迁移历史和审计语义，因此只追加当前迁移并
  在活动文档中更新当前合同。
- 把 App API 输入读取和产品回调拆成两套凭据会增加轮换与投递合同；当前需求只要求中性命名，继续
  使用一个凭据。
- 只声明角色和 schema Job 无法跨 Application 排空旧消费者；依靠人工串联会再次拆开发布链路，
  因此由 GitOps 的 Kargo 维护阶段协调。临时包装层保持应用 bundle 与原生 binding 对应，避免在生产
  Agent 中长期维护双 schema 行为。维护 profile 与包装层在旧角色、配置和发布路径完成退役后删除。
- 仅改 SealedSecret metadata 无法迁移 strict 密文；按新名称重新封装原值，发布窗口内保留旧资源。

## 后果

新版本部署必须同步更新 Agent Control、Runtime、App API、cluster-private-ingress、Ops Web、RAG
publisher、Kubernetes Secret/ConfigMap 和本地 lifecycle。旧环境变量、旧工具 registry 和旧错误码会
明确失败；GitOps promotion 不会自动重命名 Secret/ConfigMap；切换前需要由环境 owner 预置新 role、完成
配置合同切换并暂停/排空旧消费者，迁移后完成消费者 rollout，再单独退役旧 role。历史记录
中的旧名称继续存在；仓库扫描只允许它们出现在 immutable migration、切换 runbook、历史文档或明确的
旧合同拒绝测试中。

本地 secret 文件更新为 schema v3，使用 `internalSharedSecret`；已有 worktree 按本地验证 runbook
原值改名后重新渲染环境，不清空数据库、记忆或 provider 配置。生产配置不提供旧 key fallback。
