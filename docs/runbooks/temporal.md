---
doc_type: runbook
owner_boundary: temporal-platform
status: active
---
# Temporal 自托管运维

## 边界

本文说明 Temporal Server 与应用 poller 的稳定运维规则。具体 chart 版本、Helm value、namespace、
endpoint 和资源尺寸由环境仓库拥有，不在本文复制。

本文不定义应用工作流语义：在线回答见 `../architecture/system/durable-runtime.md`，个人记忆见
`../architecture/system/memory-plane.md`，Langfuse retention 见
`../contracts/langfuse-runtime.md`。平台运维不得改变这些工作流的业务状态。

execution-control 在一个标准 Deployment 中运行 workflow、core activity 和 agent activity 三类
poller；ingestion-control worker 与 source-collector worker 各使用一个标准 Deployment。副本数与
滚动更新由 Kubernetes/GitOps 管理，应用不调用 Kubernetes API，也不维护第二套自动扩缩状态。

## 所有权

- Argo CD：platform chart、Connection、标准 Deployment、ConfigMap、Secret、image digest 与
  sync order；
- Temporal：workflow history、task routing、retry、timeout、heartbeat 与 cancellation；
- Kubernetes Deployment：poller 副本、进程重启和滚动更新；
- application：确定性 workflow/activity code 与有界投影。

workflow 不调用 Argo CD 或 Kubernetes；deployment 不改写 workflow history 或产品投影。

## 在线回答超时配置

execution-control 网关通过
`EXECUTION_CONTROL_TEMPORAL_WORKFLOW_EXECUTION_TIMEOUT_SECONDS=900` 为新建在线回答设置
Temporal `WorkflowExecutionTimeout`；source K8s manifest 与本地 compose 必须显式保持同一值。
调整该值只影响之后启动的 workflow，不能缩短已经运行的 execution，也不能代替 activity deadline。
超时后的产品终态顺序由[持久 Agent 运行时](../architecture/system/durable-runtime.md#取消超时与终态处理)
定义，运维不得直接修改 PostgreSQL 投影来跳过回调或输入清理。

## 变更步骤

1. 在环境仓库确认 Temporal chart 与应用 SDK 兼容，并确认 workflow 代码能够 replay 已有 history；
1. 在任何在线回答 worker 上线前，由环境仓证明 Temporal Authorizer 或等价管理面 guard 已拒绝平台
   身份对在线回答 Workflow ID 执行 Reset；source manifest、单元测试或 Describe 结果都不能替代该
   环境部署证据；
1. render source base 与 environment overlay，并执行 schema/policy 检查；
1. 通过环境 pull request 选择 immutable image digest；
1. 合并后由 Argo CD 滚动更新所属标准 Deployment；
1. 确认目标 Pod 已在预期 task queue 注册 poller，并观察旧 Pod 正常退出；
1. 核对开放 workflow、backlog、Activity error 与产品终态后完成变更。

不得直接 patch Deployment，也不得用普通滚动更新交付无法 replay 已有 history 的 workflow code。

源码 base 只保留标准 Deployment，不再声明 `WorkerDeployment`、`WorkerResourceTemplate` 或 KEDA。
环境仓若仍有旧迁移资源，应依据该环境的开放 workflow 和 poller 状态单独完成排空与清理；不得把
这些资源重新加入源码 base 作为长期发布或扩缩容机制。

`tool_execution_v5` 是不兼容的单向切换，不使用普通 rolling drain 同时接收 v4/v5 请求。必须先按
[执行服务运维](./execution.md#v5-单向切换) 在维护窗口停止新准入并彻底排空 v4 合同 run，再让
v5 build 接管 `campus-agent.workflow.v3`、`campus-agent.activity.core.v3` 和
`campus-agent.activity.agent.v3`。队列后缀是工作流身份，不随本次应用合同改名；Worker Versioning
也不能替代输入合同切换。

## 状态检查

按环境仓库提供的 context/namespace 执行：

```bash
kubectl get connection
kubectl get deployment
kubectl get pod
```

逐个应用检查 Deployment rollout、Pod readiness、task queue poller、backlog 与旧 Pod 退出状态。

## 常见故障

### task queue 没有 poller

- 检查 Deployment 副本、Pod startup、task queue 与 Temporal namespace；
- 检查运行进程是否包含预期 poller，以及 Temporal 连接与认证；
- 检查 Pod readiness 与日志中的 worker fatal error。

### Deployment 无法滚动更新

- 检查 image digest、ConfigMap、Secret、资源和 NetworkPolicy；
- 检查新 Pod 是否在旧 Pod 退出前完成 readiness；
- workflow replay 不兼容时停止发布，按明确维护窗口排空，不新增长期兼容 worker。

### 旧 Pod 或迁移 build 无法排空

- 检查仍由旧进程执行的 workflow、Activity 与 task queue；
- workflow 或 Activity 未完成时不得强制删除旧 Pod 或迁移 CRD；
- 只按产品或 ingestion policy cancel/terminate workflow。

在线回答的 v5 切换不得直接 terminate 来满足“已排空”：取消必须先经过产品路径并完成产品
终态。无法在维护窗口完成时中止切换，继续保留完整 v4 服务，不能带着未完成 workflow 启用 v5。

### 在线回答身份或超时无法收敛

- 用 Temporal Describe 检查 execution 状态以及 Memo 中的 `campus_agent_workflow_id`、
  `campus_agent_run_id`、`campus_agent_payload_sha256`、`campus_agent_input_sha256`；
- visibility 暂不可用或 Memo 缺失属于身份未知，应恢复 visibility 后等待 reconciler 重试，不能据此
  手工确认启动或发送取消；
- 启动命令已置位 `dispatch_attempted` 但 Describe 返回 `NotFound` 时，先区分是否已有持久 Run ID。
  已有绑定表示 Temporal 身份暂不可见，取消应以 `temporal_start_identity_unresolved` 保持 pending；
  尚无绑定、start 已 `superseded` 的崩溃窗口应由 recovery starter 使用原 canonical input 和当前一分钟
  `StartDelay` 创建或取得 root，完成 exact/latest 校验、首写绑定后再走精确 Run ID 取消。检查
  `temporal_cancel_recovery_*` 错误和 starter 可用性；不得手工启动替代 Workflow 或取消 latest；
- Activity 报 `temporal_execution_binding_pending` 时检查 start 是否尚未确认精确 root Run ID；该错误
  可重试。`temporal_execution_binding_mismatch` 表示当前 Activity 的 Workflow ID 或 Run ID 与持久
  root 不同，包含 Reset successor，属于非重试身份故障；不得修改绑定来接纳它。start 已
  `superseded` 时，除 cancellation finalizer 外的 Activity 应停在
  `temporal_execution_cancellation_pending`；
- Memo 与持久命令明确冲突时保留该 execution，由应用把本地 run 失败关闭；不得将冲突 execution
  当作目标 run 强制取消；
- execution 为 `TIMED_OUT` 但尚无 `run.expired` 时，检查产品终态回调和投影存储错误；产品终态与
  `run.expired` 必须在同一投影事务中提交，app-api 持有的执行输入不随该终态清空；
- start 为 `superseded` 且 `dispatch_attempted=true` 时，必须先存在不可变的 Temporal Run ID 绑定再
  投递取消；不得将 superseded 本身当作“没有 execution”的证明；
- 当前在线回答没有 Workflow RetryPolicy、Cron 或 Continue-As-New 路径，不支持 successor；未来引入
  任一机制前必须先设计持久 chain binding，不能直接放宽 exact-run 校验；
- `COMPLETED`、`FAILED`、`CANCELED`、`TERMINATED`、`CONTINUED_AS_NEW` 和 `TIMED_OUT` 都是
  closed 状态。若对应产品 run 仍为 active，检查 active-run reconciler、产品终态回调和投影事务；
  超时应收敛为 `expired`，其余缺失产品终态的关闭应收敛为失败。不同 latest Run 或
  `CONTINUED_AS_NEW` 应以 `workflow_successor_without_authorization` 失败关闭产品 root，successor
  不得被绑定或取消；
- 在线回答不支持 Reset。平台运维不得用 Reset 绕过应用的产品终态和运行绑定；应用会拒绝把 Reset
  successor 重新绑定到原产品 run。

## 回滚与持久化

回滚通过环境 GitOps 选择已知可用 image/config template，由 Kubernetes 滚动更新所属 Deployment。
不得手工修改 Temporal history 或应用数据库来伪造回滚结果。

Temporal persistence 与 visibility database 是 platform data。backup、restore、schema upgrade
与 retention 使用 Temporal/database platform 流程，不复用 application schema migration job。

## 相关文档

- `../decisions/adr-0048-temporal.md`
- `../architecture/system/k8s-runtime.md`
- `../contracts/temporal-queues.md`
