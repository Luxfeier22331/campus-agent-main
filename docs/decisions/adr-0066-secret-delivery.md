---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0066
status: accepted
---
# ADR-0066 Secret 投递

## 背景

工作负载需要稳定引用凭据，但凭据值、投递后端和环境资源清单具有不同的所有权和生命周期。
源码示例不能证明某个环境已经投递凭据，也不能成为真实环境的凭据清单。

## 决策

workload 只以稳定 Kubernetes Secret 名与 key 作为合同。具体 secret delivery backend 属于
部署基础设施，不代表工作负载已经按目标架构运行。

- Secret 按凭据所有者、生命周期和变更边界组织，不按 Pod 重复创建；
- workload 只显式投影所需 key；共享 Secret 对象不代表共享上游身份或权限；
- 真实 secret material 不进入 plaintext git；
- 环境仓库可以保存 delivery-backend reference 或 encrypted secret resource，不能保存
  plaintext value；
- 应用源码仓库只保存稳定 consumption contract 与不含值的 placeholder；
- self-hosted GitOps 默认推荐 Sealed Secrets，以保持可审查 desired state；已有外部 secret
  manager 的环境可以使用 External Secrets Operator；
- manual Kubernetes Secret、Sealed Secrets、External Secrets Operator 与 SOPS 都是允许的
  delivery 方式，切换 backend 不得改变 first-party workload consumption contract；
- 需要频繁人工轮换的短期凭据可以使用预创建的固定 Secret，由明确白名单内的集群操作更新；
  该例外必须限制到资源名，不得授予 Secret 创建、列举或删除权限，也不把 Git 变成凭据历史。

Cloudflare Worker 独占的 secret 留在 Cloudflare secret store，通过部署前检查工具确认是否
存在，不镜像到 Kubernetes。跨运行时认证凭据是例外：当 Kubernetes 调用方与 Cloudflare
Worker 验证方必须校验同一个值时，运维人员在可信环境生成一次，分别投递到两个密钥存储，
并将两端作为同一轮换单元；任一密钥存储都不充当另一个密钥存储的同步源。Kubernetes secret
delivery 也不拥有 Docker 本地 secret 或应用级运维配置。

## 后果

- K8s runtime 不再维护 `secret.example.yaml` inventory；
- 内部门户 `SSO_TGC` 使用环境预创建的独立 Secret。Ops Web 只允许读取和 patch 该固定 Secret，
  并读取固定认证 CronJob；Role 通过 `resourceNames` 限制目标，不授予 list、create、delete 或
  其他 Secret 权限。长期 API key、DSN 和信任锚仍使用环境的常规投递方式；
- TGC 不与其他凭据共用 Secret，因为 Kubernetes Secret RBAC 只能限制资源，不能限制 key；
- 小型 self-hosted deployment 可以手工创建 Secret，但 operator 必须负责轮换；
- 环境仓库可以部署 pinned secret-delivery controller；
- SealedSecret 默认使用 strict scope，namespace-wide 或 cluster-wide scope 需要单独风险接受；
- policy check 必须拒绝 GitOps manifest/Helm value 中的 provider key、DSN、token 与 shared
  secret；
- local `.env` 只能作为受控 Secret 创建步骤的输入，本身不是 Kubernetes desired state；
- repo check 可以验证 Secret/ConfigMap 分离、稳定 key 与禁止位置，但不能证明真实 secret 已
  正确投递。

## 未采用方案

### 强制 External Secrets Operator

拒绝。已有外部 secret manager 时它很合适，但会为小型 self-hosted 环境增加不必要 controller
与 backend dependency。

### 只允许 Sealed Secrets

拒绝。Sealed Secrets 仍需要 controller 与 sealing-key lifecycle，因此作为推荐默认值，而不是
唯一 substrate。

### 把 `.env` 复制到 staging host

拒绝作为仓库合同。operator 可以把 local env 作为受审查 secret creation 输入，workload 只能
消费 Kubernetes Secret。

### 用业务配置服务充当通用 secret manager

拒绝。业务配置控制面不负责通用部署 credential。
