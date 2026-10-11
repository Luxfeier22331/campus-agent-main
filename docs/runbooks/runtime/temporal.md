---
doc_type: runbook
owner_boundary: temporal-platform
status: active
---
# Temporal 自托管运维

## 边界

本文说明 Temporal Server 与 agent-runtime-worker poller 的稳定运维规则。具体 chart 版本、Helm
value、namespace、endpoint 和资源尺寸由环境仓库拥有，不在本文复制。

本文不定义应用工作流语义：在线回答见 [持久 Agent 运行时](../../architecture/system/durable-runtime.md)，个人记忆见
[个人记忆](../../architecture/system/memory-plane.md)。平台运维不得改变这些工作流的业务状态。

agent-runtime-worker 在一个标准 Deployment 中运行 workflow、core activity 和 agent activity 三类
poller。副本数与滚动更新由 Kubernetes/GitOps 管理，应用不调用 Kubernetes API，也不维护第二套
自动扩缩状态。通知采集到 RAG 刷新的编排由 `notice-pipeline-worker` 在独立的 `notice-pipeline` 与
`notice-artifacts` 队列执行，不占用 agent-runtime-worker 的 poller，见[采集与离线数据运维](../ingestion/ingestion.md)。

本地 Temporal 测试属于 integration 验证，不是完整产品 E2E。它使用 Temporal Dev Server、测试 worker
和测试 projection，不连接 staging、真实 Agent Runtime 或 PostgreSQL。运行入口由 agent-control
package script 管理，禁止使用已废弃的混合 `temporal_e2e` build tag。

`test:temporal-integration` 按 package 复用 Dev Server，按测试启动 worker；日志分别标记 server、worker、
workflow、history replay 和 cleanup。测试失败或超时由 `integration/temporaltest` 关闭 worker、client
和 server，不依赖 `pnpm dev`。`test:temporal-replay` 只验证已提交 history，不启动外部服务。

`integration/temporal` 用生产 30 秒 heartbeat 验证 activity timeout/retry，用缩短的测试执行预算验证
workflow 硬超时，并确认 finalization 后 memory append 作为独立 workflow 运行，不阻塞已完成回答。测试不改变生产的
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

agent-control 网关为新建在线回答固定设置 900 秒的 Temporal `WorkflowExecutionTimeout`。该值由
源码常量拥有，不是环境变量；source K8s manifest、本地 compose 和环境仓均不投递覆盖值。修改超时
必须调整源码并验证受影响的启动合同，只影响之后启动的 workflow，不能缩短已经运行的 execution，
也不能代替 activity deadline。
超时后的产品终态顺序由[持久 Agent 运行时](../../architecture/system/durable-runtime.md#取消超时与终态处理)
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

`task_replan.v3` 删除旧 `insufficient` 决策及综合回答的模式字段；不支持跨版本恢复旧运行。
发布采用维护窗口排空：
先暂停新在线 run 准入，保持旧 agent-control 与 agent-runtime 运行，等待已接受的在线 run、
待投递启动命令和开放的在线回答 workflow 收敛；旧 poller 退出后协调升级两个服务，再恢复准入。
排空未完成不得发布该版本，不添加 alias、兼容 worker 或 version marker。
历史记录不删除；需要离线回放旧 history 时使用对应旧版本。

## 状态检查

按环境仓库提供的 context/namespace 执行：

```bash
kubectl get deployment
kubectl get pod
```

检查 agent-runtime-worker Deployment rollout、Pod readiness、task queue poller、backlog 与旧 Pod
退出状态。

## 当前部署边界

AgentWorkflow 的三个 poller 由 agent-runtime-worker 拥有，Memory 的 Workflow 与 Activity 由 memory-worker 拥有。
Control 只启动、取消和查询 Workflow。旧 Go Worker 与 HTTP Runtime 已从生产 base 移除，不支持旧 Go history。
本次保持固定副本，不启用新的自动扩缩容。已有 Memory 数据库、Hindsight bank 与 owner salt 不变。
