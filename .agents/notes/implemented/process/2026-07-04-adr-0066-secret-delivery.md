# Agent Note: ADR-0066 Secret 投递

Status: implemented

## 背景

工作负载需要稳定引用凭据，但凭据值、集群交付资源和应用消费合同具有不同的所有权与生命周期。
源码仓不应保存明文凭据，也不应把具体环境状态写成应用能力。

## 决策

- 当前 Kubernetes 集群的 workload Secret 交付方案选择 Sealed Secrets；加密资源、namespace 和
  trust anchor 由环境/GitOps 仓维护；
- 源码仓只维护稳定的 Secret 名称与 key consumption contract，以及不含值的示例；
- workload 只显式消费完成其职责所需的 key，不在代码中解析或复制整份 Secret；
- Secret 的共享或拆分按凭据所有权、信任边界和生命周期决定，不按 Pod、Job 或进程名称自动拆分；
- 明文 Secret 不进入 Git、镜像、ConfigMap 或前端产物；
- Cloudflare Worker 使用其所属的 secret store，不把 Worker 独占密钥复制到 Kubernetes；跨运行时必须
  使用同一凭据时，由环境交付分别投递并作为同一轮换单元维护。

具体 Secret 名称、key、权限和环境值由应用合同与环境仓维护。本 ADR 不列出凭据清单，也不描述某次
环境的投递状态。

## 未采用方案

- **把明文 Secret 放入源码仓或 ConfigMap**：会扩大泄露范围并混淆配置与凭据边界；
- **让业务配置服务充当通用 Secret 管理器**：业务配置不拥有集群凭据交付生命周期。

## 后果

- workload 通过环境仓交付的 SealedSecret 消费稳定 key，不自行创建或选择 Secret 交付后端；
- 环境仓可以审查 SealedSecret desired state，但源码仓不获得真实凭据；
- 业务数据中的用户凭据（例如 Ops Web 持久化的内部门户 TGC）仍由所属数据模型维护，不被
  误当作 workload Secret；
- internal-portal-collection 不读取部署 TGC Secret；本地命令的显式输入和集群 Job 经内部 API 解析的
  TGC 不改变集群 Secret 合同；
- 删除最后一个 Secret 消费者时，必须同时删除其 key 合同、环境资源引用、权限和文档。

## 相关文档

- [环境配置](../../../../docs/environment/README.md)
- [环境文件](../../../../docs/environment/env.md)
- [ADR-0065 GitOps](./2026-07-16-adr-0065-gitops.md)
- [ADR-0074 源码仓库与环境仓库边界](./2026-07-16-adr-0074-repository-boundary.md)
