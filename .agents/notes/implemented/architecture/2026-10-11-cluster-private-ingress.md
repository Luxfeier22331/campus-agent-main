# Agent Note: 集群私有入口与 Worker 凭据边界

Status: implemented

## 背景

[Agent 与 Memory 拆分](2026-10-10-agent-orchestration-memory-services.md)形成了独立服务，但 Worker
仍分别绑定 Control 和 Memory，并消费 Memory 内部凭据。每拆出一个服务都要改变边缘绑定和凭据，
且 Control 入站与产品回调共用凭据，部署拆分没有形成明确的访问边界。

## 决策

Worker 构建 owner 的后续调整见[Worker 发布闭环迁入 GitOps](../process/2026-10-11-worker-publication-gitops.md)，
该篇取代下述 Source 构建 bundle 与跨仓输入传递安排；其余入口与凭据边界继续有效。

使用独立 Go 应用 `cluster-private-ingress`，让 Worker 通过一个 VPC Service binding 消费集群产品
接口。入口拥有认证、固定产品路由和后端凭据注入；Control、Memory 保留业务状态和错误语义。
入口不访问数据库，不编排业务、不验证用户所有权，也不成为集群内部互调的中转站。

Worker 持有 edge 入口凭据；Control 入站使用独立 secret，原产品回调 secret 保持原用途。
Memory 的内部 secret 留在入口和实际集群消费者。入口仅转发现有产品操作，不暴露 Runtime
投影写入、recall、append；不向后端传递边缘认证、Cookie 或任意 Authorization。
后端通过 NetworkPolicy 接受入口和原有集群消费者，取消 connector 对这两个后端的直接访问。

Object Store 仍使用独立 binding，因为 AWS SigV4 依赖 Host、query 和签名头，且传输包含流式对象。
将其接入本次产品接口代理会引入不必要的协议适配。

Source 交付应用、镜像、K8s base、Worker 消费合同；GitOps 拥有环境 Secret、VPC Service、connector
与部署选版。Memory 客户端与 Hindsight 服务端的 NetworkPolicy 使用不同名称，避免跨 Application
争用同一对象。Worker 发布也按此边界迁移：Source 仅构建 digest 固定的 bundle；GitOps 准备固定 Docs 快照和公开构建值，
上传时注入环境配置、binding 和共享凭据，创建原生版本并选择流量。原生私有 secret 由 Wrangler 继承。
正式发布的 provider 可用性核验在 GitOps 运行，Source 只转交发布请求。

## 未采用方案

Kubernetes Gateway API 能统一声明路由，适合已有 controller 和多个独立路由 owner 的场景。
当前需要固定产品操作与应用认证适配，引入 controller 不会消除凭据转换，因此先使用应用入口。
以后出现多协议或多个独立路由 owner 时再评估替换，业务服务不能依赖入口内部实现。

Worker 直接绑定各服务最少增加一跳，但会继续承担内部拓扑和凭据分发，不满足本次边界调整。
通用任意路径反代更易扩展，却会把仅供集群的写接口变成 Worker 能力；新增产品操作应显式加入路由表。

Source build 不读取对象存储或 Cloudflare 凭据。Docs 快照由 GitOps 调用所选 Source 的发布与读取逻辑生成，
同一次快照固定每个对象的读取结果。GitOps 上传 bundle 不重新编译；Deployment 创建时记录所选工件与
解析后的原生 versionId，恢复重用该记录。选版文件保留 artifactRef；正式版本从成功 Deployment
读取原生 versionId，并与该 revision 的 artifactRef/sourceSha 核对，正式回滚选择已验证的原生版本。

## 后果

新增一个独立部署单元和一次 HTTP 转发；入口故障会影响 Worker 到 Control/Memory 的产品操作。
透传状态、响应流和取消，不增加业务重试，保持已有命令幂等与 Workflow 所有权。
本地开发也经过入口，避免本地直连掩盖部署合同问题。

部署必须先备好入口和新的环境输入，再发布 Worker。旧 Worker 版本及旧 VPC 资源可在切换窗口
保留；回滚需要同时还原 Control 入站认证和相应网络策略，不能只回退 Worker。真实 VPC 连通、
环境凭据及产品会话/记忆操作需要在 GitOps 消费新版制品后验收。

入口的固定路由、凭据隔离和 HTTP 透传由入口单元测试与真实 HTTP 集成测试共同覆盖；跨进程测试保持显式运行，
不混入快速包测试。
