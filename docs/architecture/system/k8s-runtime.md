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

`infra/k8s/execution-runtime/base` 与 `infra/k8s/ingestion-runtime/base` 分别提供 execution 和
ingestion 的完整聚合视图。常驻 workload 位于各自 `runtime/`。内部门户凭据检查属于 Ops Web，
由 `infra/k8s/ops-web/base` 中使用同一镜像的 CronJob 执行，不是 ingestion 子部署单元。

精确资源、标签、探针和配置引用以 Kustomize 清单为准，不在架构文档维护副本。源码 base 不选择
具体环境或可变镜像标签。子单元可以引用同 namespace 中由运行时或 foundation 唯一拥有的
ServiceAccount、ConfigMap 和 Secret，不得复制共享资源所有权。

当前稳定进程形态是：

- `execution-control`：一个标准 Deployment，同时提供执行 API、Provider Config 管理 API 和三类
  Temporal poller；
- `agent-runtime`：一个独立 Deployment；
- `ingestion-control` API、`ingestion-control-worker` 与 `source-collector-worker`：三个标准
  Deployment；
- `ops-web-internal-portal-check`：顺序检查 Ops Web 所有内部门户凭据的 CronJob；
- OpenTelemetry Agent：环境仓部署的一个 DaemonSet，采集节点日志和 kubelet metrics；
- OpenTelemetry Gateway：环境仓部署的一个 Deployment，提供受控 OTLP/HTTP 入口和下游路由。

Temporal Server 是运行前置条件。源码 base 只声明标准 Deployment，不声明 Worker Controller、
WorkerDeployment、WorkerResourceTemplate 或 KEDA 资源。

## 发布与容量

标准 Deployment 由 Argo CD 选择不可变镜像并执行滚动更新。workflow 代码变更必须保持 Temporal
replay 兼容；确实不兼容的执行合同使用维护窗口排空，不通过第二套长期 worker 路由兼容旧合同。
应用不自行部署、重启或修改 Kubernetes 资源。

当前小规模环境使用明确副本数和 SDK 并发上限，不为这些 poller 维护 KEDA/HPA。容量调整由环境仓
修改所属 Deployment 的副本与资源；Temporal task queue backlog 只作为运行观测，不进入应用
数据库或自研扩缩器。

## 状态职责

- Argo CD 选择源码声明的基础资源、不可变镜像和环境配置；
- Temporal 保存 workflow/activity history、任务投递、retry、timeout 和 cancellation；
- Kubernetes Deployment 管理进程副本与滚动更新；
- PostgreSQL 只保存产品或采集投影。

workflow 代码不得部署、重启或修改自己的 Kubernetes 资源。

## 网络与凭据

源码 base 用稳定 workload label 声明应用级 NetworkPolicy 和端口，环境 overlay 只替换真实网络
目标。浏览器不能直连
Temporal、worker、数据库或对象存储。

环境仓为不同服务提供最小权限 Secret，并满足源码声明的 key 消费合同。运行身份、用户凭据和外部服务
凭据不能混用；精确 Secret、NetworkPolicy 和地址以 base 与环境配置为准。

第一方 workload 禁止使用 `envFrom.secretRef`。每个进程只通过显式
`env[].valueFrom.secretKeyRef` 引用实际读取的 key；多个进程需要同一逻辑凭据时引用同一 Secret
key，不创建按消费者复制的影子 Secret。非敏感 ConfigMap 不受此限制。

## 镜像与发布

源码 CI 生成并校验不可变候选物，环境仓通过 digest 选择部署版本。候选物存在不表示已部署；
实际状态由环境 revision 和 controller 状态确认。发布操作见 `docs/runbooks/release.md`。

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
