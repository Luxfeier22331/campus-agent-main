---
doc_type: architecture
owner_boundary: temporal-worker-runtime
status: active
---

# Kubernetes 运行时

## 边界

本文定义源码仓中的第一方 Kubernetes 基础资源及其平台职责。环境仓负责 Argo CD Application、
namespace、不可变镜像、环境配置、凭据对象和实际资源额度。

## 运行时基础

`infra/k8s/execution-runtime/base`、`infra/k8s/model-config/base`、`infra/k8s/ops-web/base` 与
`infra/k8s/ingestion-runtime/base` 分别提供 execution、模型配置、运维应用和采集 Job 的源码期望状态。
常驻 workload 位于各自 `runtime/` 或 base。内部门户凭据 API 与检查由 Ops Web 及其
`ops-web-internal-portal-check` CronJob 执行；ingestion runtime 只保留采集 Job 模板。

精确资源、标签、探针和配置引用以 Kustomize 清单为准，不在架构文档维护副本。源码 base 不选择
具体环境或可变镜像标签。子单元可以引用同 namespace 中由运行时或 foundation 唯一拥有的
ServiceAccount、ConfigMap 和 Secret，不得复制共享资源所有权。

当前稳定进程形态是：

- `execution-control`：一个标准 Deployment，提供执行 API 和三类 Temporal poller；
- `model-config`：一个独立 Deployment 和一个 `8000` 端口的 Service；数据库结构由 data-postgres
  Application 中的统一 `campus-agent-schema` Job 安装；
- `agent-runtime`：一个独立 Deployment；
- `ops-web`：一个运维 API Deployment；
- `ops-web-internal-portal-check`：使用 Ops Web 凭据 store 顺序检查凭据池的 CronJob；
- `internal-portal-collection` 提供一个镜像和共用采集实现；ingestion runtime base 声明通知增量、通知
  回填和文件发布三个默认暂停的 CronJob 模板，每个模板固定一种动作，没有常驻 Deployment 或自动调度。

Temporal Server 只属于 execution-control 的运行前置条件。源码 base 只声明标准 Deployment，不声明 Worker Controller、
WorkerDeployment、WorkerResourceTemplate 或 KEDA 资源。

Agent Runtime 的可选 OTLP endpoint 由环境仓选择。源码仓不把 OpenTelemetry Agent/Gateway、节点
日志采集或 kubelet metrics 作为应用运行时的固定组件。

## 发布与容量

标准 Deployment 由 Argo CD 选择不可变镜像并执行滚动更新。workflow 代码变更必须保持 Temporal
replay 兼容；确实不兼容的执行合同使用维护窗口排空，不通过第二套长期 worker 路由兼容旧合同。
应用不自行部署、重启或修改 Kubernetes 资源。

当前小规模环境使用明确副本数和 SDK 并发上限，不为这些 poller 维护 KEDA/HPA。容量调整由环境仓
修改所属 Deployment 的副本与资源；Temporal task queue backlog 只作为运行观测，不进入应用
数据库或自研扩缩器。

## Job 运行合同

一次性 schema/bootstrap Job 必须有 `activeDeadlineSeconds`、CPU/memory requests 和 limits；
数据库迁移连接使用显式单连接上限。需要访问同一外部资源或同一数据边界的 CronJob 必须声明
`concurrencyPolicy: Forbid`，并设置足以终止卡住执行的 active deadline。

当前合同中的代表性规则是：

- `data-postgres` Application 中的 `campus-agent-schema` 是唯一 schema Job，使用现有
  `campus_agent` owner 和 PostgreSQL CA；`ops-web-bootstrap` 只执行 Dining bootstrap，不执行 DDL；
  其他 package 的 migration runner 不得成为独立 workload 或 GitOps schema 入口；
- internal-portal collection/check 和 Campus Docs 三个阶段 Job 使用 `Forbid`，并有 active
  deadline 与 resources；
- Campus Docs 三个阶段和 internal-portal 三个模板默认 `suspend: true`，不因源码存在而自动运行；
- Job 的 `ttlSecondsAfterFinished` 只负责完成后的 Job 对象回收，不替代数据 retention 或备份。

Ops Web 按需从暂停的通知 CronJob 模板创建 Job。GitOps 只管理 CronJob 模板；动态 Job 通过
`ownerReference` 归属来源模板，不构成独立 desired state 或顶层 orphan。动态 Job 固定不重试并在完成
24 小时后回收，成功和失败状态只作为该窗口内的运行历史，不参与 Argo CD 或服务健康判断。

这些是 desired-state 合同。清单通过测试只证明仓库期望状态可检查，不能证明某个环境已经启用模板、
控制器已经创建 Job，或 Job 实际获得了相应资源。

## 状态职责

- Argo CD 选择源码声明的基础资源、不可变镜像和环境配置；
- Temporal 保存 workflow/activity history、任务投递、retry、timeout 和 cancellation；
- Kubernetes Deployment 管理进程副本与滚动更新；
- PostgreSQL 保存产品数据、执行投影、Model Config 当前配置和 Ops Web 所有的内部门户凭据池。

workflow 代码不得部署、重启或修改自己的 Kubernetes 资源。

## 网络与凭据

源码 base 用稳定 workload label 声明应用级 NetworkPolicy 和端口，环境 overlay 只替换真实网络
目标。浏览器不能直连
Temporal、worker、数据库或对象存储。

环境仓为不同服务提供其实际消费的 Secret，并满足源码声明的 key 消费合同。运行身份、用户凭据和外部服务
凭据不能混用；精确 Secret、NetworkPolicy 和地址以 base 与环境配置为准。
Model Config 与 `app.kubernetes.io/part-of=campus-agent` 的内部 Pod 位于共同受信任边界，访问单一
Service 时不使用额外 consumer token；NetworkPolicy 允许这些内部 Pod 访问 TCP 8000。

第一方 workload 禁止使用 `envFrom.secretRef`。每个进程只通过显式
`env[].valueFrom.secretKeyRef` 引用实际读取的 key；多个进程需要同一逻辑凭据时引用同一 Secret
key，不创建按消费者复制的影子 Secret。非敏感 ConfigMap 不受此限制。

## 镜像与发布

Kubernetes 候选物、环境选择和实际发布的所有权见
[运行时发布架构](./runtime-release.md)；本文件只维护 Kubernetes 运行时资源和平台职责。

## 不允许的形态

- 为 workflow、core activity 和 agent activity 各维护一个长期独立 Deployment；
- 引入 Worker Controller、WorkerDeployment、WorkerResourceTemplate 或 KEDA 作为应用发布或扩缩容
  机制；
- 使用自研 task queue 采样器或副本执行器；
- workflow 调用 Kubernetes 或 Argo CD；
- 应用自行维护 worker build routing。

## 相关文档

- `docs/runbooks/temporal.md`
- `docs/runbooks/release.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/data-plane.md`
