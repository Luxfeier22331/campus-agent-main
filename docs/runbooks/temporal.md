---
doc_type: runbook
owner_boundary: temporal-platform
status: active
---
# Temporal 自托管运维

## 边界

本文说明 Temporal Server 与 execution-control poller 的稳定运维规则。具体 chart 版本、Helm
value、namespace、endpoint 和资源尺寸由环境仓库拥有，不在本文复制。

本文不定义应用工作流语义：在线回答见 `../architecture/system/durable-runtime.md`，个人记忆见
`../architecture/system/memory-plane.md`。平台运维不得改变这些工作流的业务状态。

execution-control 在一个标准 Deployment 中运行 workflow、core activity 和 agent activity 三类
poller。副本数与滚动更新由 Kubernetes/GitOps 管理，应用不调用 Kubernetes API，也不维护第二套
自动扩缩状态。采集链路不使用 Temporal，见[采集与离线数据运维](./ingestion.md)。

本地 Temporal 测试属于 integration 验证，不是完整产品 E2E。它使用 Temporal Dev Server、测试 worker
和测试 projection，不连接 staging、真实 Agent Runtime 或 PostgreSQL。运行入口由 execution-control
package script 管理，禁止使用已废弃的混合 `temporal_e2e` build tag。

`test:temporal-integration` 按 package 复用 Dev Server，按测试启动 worker；日志分别标记 server、worker、
workflow、history replay 和 cleanup。测试失败或超时由 `integration/temporaltest` 关闭 worker、client
和 server，不依赖 `pnpm dev`。`test:temporal-replay` 只验证已提交 history，不启动外部服务。

`integration/temporal` 用生产 30 秒 heartbeat 验证 activity timeout/retry，用缩短的测试执行预算验证
workflow 硬超时，并确认 finalization 后 memory append 仍阻塞 workflow 完成。测试不改变生产的
900 秒总预算。stream 的三类 completed 失败验证位于独立的 `integration/stream`，当前已发布的 delta
在失败后仍保留；receipt 的完整结果恢复、冲突和随父 run 删除的行为由 PostgreSQL integration 验证。
这些测试记录 #401、#414、#415、#416 的当前边界，不表示相关产品语义已修改。

## 所有权

- Argo CD：platform chart、标准 Deployment、ConfigMap、Secret、image digest 与 sync order；
- Temporal：workflow history、task routing、retry、timeout、heartbeat 与 cancellation；
- Kubernetes Deployment：poller 副本、进程重启和滚动更新；
- application：确定性 workflow/activity code 与有界投影。

workflow 不调用 Argo CD 或 Kubernetes；deployment 不改写 workflow history 或产品投影。

## 在线回答超时配置

execution-control 网关为新建在线回答固定设置 900 秒的 Temporal `WorkflowExecutionTimeout`。该值由
源码常量拥有，不是环境变量；source K8s manifest、本地 compose 和环境仓均不投递覆盖值。修改超时
必须调整源码并验证受影响的启动合同，只影响之后启动的 workflow，不能缩短已经运行的 execution，
也不能代替 activity deadline。
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
删除 workflow command、timer 或 activity 时，先用 SDK version marker 保留旧 history 分支，并继续
注册旧 history 仍会调度的 activity。只有旧 poller 退出前启动的相关开放 workflow 全部终止后，后续
发布才能删除旧分支和 activity；固定 version marker 继续保留，不能复用其 change ID。

## Replanner 决策收敛发布

删除旧 `revise` 决策的版本不支持回放包含该结果的旧 history。发布采用维护窗口排空：
先暂停新在线 run 准入，保持旧 execution-control 与 agent-runtime 运行，等待已接受的在线 run、
待投递启动命令和开放的在线回答 workflow 收敛；旧 poller 退出后协调升级两个服务，再恢复准入。
排空未完成不得发布该版本，不添加 alias、兼容 worker 或 version marker。
历史记录不删除；需要离线回放旧 history 时使用对应旧版本。

## 状态检查

按环境仓库提供的 context/namespace 执行：

```bash
kubectl get deployment
kubectl get pod
```

检查 execution-control Deployment rollout、Pod readiness、task queue poller、backlog 与旧 Pod
退出状态。

## 常见故障

### task queue 没有 poller

- 检查 Deployment 副本、Pod startup、task queue 与 Temporal namespace；
- 检查运行进程是否包含预期 poller，以及 Temporal 连接与认证；
- 检查 Pod readiness 与日志中的 worker fatal error。

### Deployment 无法滚动更新

- 检查 image digest、ConfigMap、Secret、资源和 NetworkPolicy；
- 检查新 Pod 是否在旧 Pod 退出前完成 readiness；
- workflow replay 不兼容时停止发布，按明确维护窗口排空，不新增长期兼容 worker。

### 旧 Pod 无法退出

- 检查仍由旧进程执行的 workflow、Activity 与 task queue；
- workflow 或 Activity 未完成时不得强制删除旧 Pod 或迁移 CRD；
- 只按产品策略 cancel/terminate workflow。

### 在线回答身份或超时无法收敛

- 用 Temporal Describe 检查 execution 状态以及 Memo 中的 `campus_agent_workflow_id`、
  `campus_agent_run_id`、`campus_agent_payload_sha256`、`campus_agent_input_sha256`；
- 首次绑定时 Describe 暂不可用、Memo 或 reset state 缺失属于身份未知，应恢复读取后等待重试，
  不能据此手工确认启动。已有绑定时只检查精确 Workflow ID/Run ID 的状态，Memo、reset state 或
  latest 不再阻断取消和终态收敛；
- 启动命令已置位 `dispatch_attempted` 但 Describe 返回 `NotFound` 时，先区分是否已有持久 Run ID。
  已有绑定表示 Temporal 身份暂不可见，取消应以 `temporal_start_identity_unresolved` 保持 pending；
  尚无绑定、start 已 `superseded` 的崩溃窗口应由 recovery starter 使用原 canonical input 和当前一分钟
  `StartDelay` 创建或取得 root；starter 完成首次精确 Run ID 校验，reconciler 首写绑定后读取当前
  状态并走精确 Run ID 取消，不重复 starter 的身份校验。检查
  `temporal_cancel_recovery_*` 错误和 starter 可用性；不得手工启动替代 Workflow 或取消 latest；
- Activity 报 `temporal_execution_binding_pending` 时检查 start 是否尚未确认精确 root Run ID；该错误
  可重试。`temporal_execution_binding_mismatch` 表示当前 Activity 的 Workflow ID 或 Run ID 与持久
  root 不同，包含 Reset successor，属于非重试身份故障；不得修改绑定来接纳它。start 已
  `superseded` 时，除 cancellation finalizer 外的 Activity 应停在
  `temporal_execution_cancellation_pending`；
- 首次绑定的 Memo 与持久命令明确冲突时保留该 execution，由应用收口本地 run；不得将冲突 execution
  当作目标 run 强制取消；
- execution 为 `TIMED_OUT` 但尚无 `run.expired` 时，检查产品终态回调和投影存储错误；产品终态与
  `run.expired` 必须在同一投影事务中提交，app-api 持有的执行输入不随该终态清空；
- start 为 `superseded` 且 `dispatch_attempted=true` 时，必须先存在不可变的 Temporal Run ID 绑定再
  投递取消；不得将 superseded 本身当作“没有 execution”的证明；
- 当前在线回答没有 Workflow RetryPolicy、Cron 或 Continue-As-New 路径，不支持 successor；未来引入
  任一机制前必须先设计持久 chain binding，不能直接放宽 exact-run 校验；
- `COMPLETED`、`FAILED`、`CANCELED`、`TERMINATED`、`CONTINUED_AS_NEW` 和 `TIMED_OUT` 都是
  closed 状态。若对应产品 run 仍为 active，检查 active-run reconciler、产品终态回调和投影事务；
  超时应收敛为 `expired`，其余缺失产品终态的关闭应收敛为失败，取消路径对已取消 root 沿用本地
  取消收口。`CONTINUED_AS_NEW` 直接以不可重试的 `runtime_invariant_failed` 收口，不需要查找
  successor。latest 改变不影响 root 按自身状态收敛；其他 execution 不得被绑定或取消；
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
