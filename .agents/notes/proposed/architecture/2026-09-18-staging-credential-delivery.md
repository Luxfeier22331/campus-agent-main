# Agent Note: Staging 凭据由 Sealed Secrets 投递到 GitHub Environment

Status: proposed

## 背景

旧的 GitHub workflow 从空的 Environment Secret 读取六个运行时值并覆盖 Source，导致凭据被清空。运行时凭据已经由 GitOps SealedSecret 在 staging 集群中还原。

## 提案

由 `source-credentials-staging` Argo Application 统一拥有三组业务 SealedSecret，并通过 PostSync Job 将六个值投影到 Source `staging` Environment。Job 使用现有 GitHub App 身份，不访问 Kubernetes API；GitHub Environment Secret 仅作为 runner 消费副本。Source Worker 发布在继续前检查受信任的 Argo release status。

## 未采用方案

不继续使用旧 reusable workflow，不部署 ESO，不为不同模块新增 GitHub App 或对象存储身份，也不要求 runner 持有集群凭据。

## 风险

GitHub Environment Secret 更新是六次独立写入，失败后通过修复外部问题并重新 Argo sync 恢复。Job 镜像和 GitHub App SealedSecret 需要在首次激活前完成构建、发布和加密 bootstrap。

## 验收标准

六值投递、失败门禁、Secret 所有权迁移及 Dining 发布均完成真实验证后转为 implemented。
