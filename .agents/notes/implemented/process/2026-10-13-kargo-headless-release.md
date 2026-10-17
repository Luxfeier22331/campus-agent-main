# Agent Note: 无 UI Kargo 发布编排

Status: implemented

## 背景

Source candidate、GitOps 期望状态、Argo CD、Cloudflare Terraform 与 Worker 原生版本各自已有明确 owner，
但旧的 GitHub Actions deployment、自动合并、状态 webhook 和恢复入口同时承担候选选择、跨平台顺序和部署
结果协调。继续扩展这些 workflow 会让构建、期望状态和执行事实互相耦合。

## 决策

Kargo 作为 staging 发布编排 owner，使用无 UI 的 Project、Warehouse、Stage、PromotionTask 和项目凭据。
Source 发布不可变 OCI candidate；GitOps 将 candidate 组装到 `candidates/staging` 或 `candidates/manual`，
并保留环境期望状态 owner。Kargo 读取 candidate，生成选版 PR，等待该 PR head 上的 `validate` 检查成功后
合并，按发布计划调用 `kargo-execute.yml` 的单一 action，等待 Argo CD Application 健康，再调用 Worker traffic Terraform，最后写 GitHub Deployment
和 Source status。

Source candidate 持续声明未完成的环境维护迁移；GitOps 只在对应迁移成功完成后记录完成状态。原先由 Kargo
在同一 Stage 内选择普通发布或维护阶段；该选择已随唯一 profile 完成而移除，见
[移除 Kargo Stage 维护编排](../simplification/2026-10-17-retire-kargo-maintenance-orchestration.md)。
候选仍声明未完成迁移时，普通发布在 prepare 失败。不通过 Promotion 请求变量选择维护模式，staging 自动
晋级不因迁移而暂停。

选版 PR 的合并不能依赖 `git-merge-pr` 的 `wait`：它只等待 PR 可合并，不检查 CI，而两个仓库没有分支
保护，选版 PR 曾在 `validate` 完成前被合并。Stage 在合并前用 HTTP 步骤读取 PR head SHA 上最新的
`validate` check run，成功才合并，非 success 结论使 Promotion 失败；render contract 要求每个合并步骤
之前都有这一检查。promoter App 因此需要 GitOps Checks read。

GitHub Actions 只执行被 Kargo 指定的 action：它不选择 Freight、不决定发布范围、不轮询 Argo，也不创建第二个
发布状态机。Argo CD 继续拥有 Kubernetes 期望状态，Terraform 继续拥有 Cloudflare 资源与 traffic，Kargo
只协调它们的顺序和结果。Kargo controller 通过 GitHub repository credential 访问 GitHub API；凭据使用严格
作用域 SealedSecret，不把私钥写入仓库。

Kargo chart 使用稳定 1.x 约束 `>=1.12.4 <2.0.0`，通过 Argo CD OCI Helm source 自动跟随稳定 patch；
API/UI、Dex 和 external webhook server 关闭。动态 schema 生成器从实际解析的 chart 提取 CRD schema，防止
校验使用另一份固定 CRD。

正式版本选择写入完整 `formalRelease` candidate，不借用最新 Source 快照；manual Warehouse 只负责把该
完整版本交给关闭自动晋级的 manual Stage。staging Stage 只订阅常规候选。正式选择仍通过 ProjectConfig PR
暂停 staging，等待在途发布完成，手动发布成功后再恢复；该正式发布协调流程不适用于自动执行的维护迁移。

发布范围从最后成功 Deployment 到选版后的树累计计算；没有成功记录时选择全部发布目标，空差异
复用成功版本。Source 自动和手动发布都只接受 main，避免功能分支改变共享的发布基线。

Argo 的 GitOps source 不再用 merge SHA 判断同步完成；文档提交也会改变 SHA，却不改变部署内容。
同步、流量切换和完成前，Kargo 原生 HTTP step 按与 apply guard 相同的文件范围重新比较期望状态；
实际部署内容已改变则停止旧发布。检查不依赖可复用的 workflow 成功记录，固定 Helm revision 仍需匹配。

候选保留使用既有 Deployment 的成功 candidate 与 Git 历史：边界及其后的候选仍可晋级，之前被取代的
普通候选退出保留与 prepare 范围，历史选择使用正式版本。Source 按成功快照的 registry 创建时间保留
该快照和之后的全部快照及引用，覆盖尚未进入 GitOps 候选分支的交接；latest、正式版本、当前选择和
可恢复部署继续保护。首次成功前没有清理边界，保护全部候选。Source 清理无需读取集群状态。

## 未采用方案

### 保留旧 GitHub Actions deployment coordinator

拒绝。它会继续复制 Promotion、Deployment、Argo 等待和恢复语义，增加两个 owner 之间的状态分叉。

### 使用 Kargo UI 或自定义外部 webhook 服务

拒绝。当前操作通过 Git、Kubernetes API 和现有 GitHub workflow 已足够，UI 与外部 webhook 会增加控制面
资源和公开入口，但不增加当前完成条件所需能力。

### 用分支保护的 required checks 约束合并

由 GitHub 在合并时强制检查最直接，也不需要 Kargo 读取 check run。当前套餐不提供该能力，所以检查
放在 Kargo 合并步骤之前；以后启用分支保护时，Stage 检查可以保留为重复但无害的前置等待。

### 让 Kargo 修改长期 Application source

拒绝。Kargo 的 `argocd-update` 同步 Application 跟踪的 main，GitOps main 仍是 Application source 和环境
配置的唯一 owner。

## 后果

- 候选选择、选版 PR、Argo 等待、Worker 流量切换和发布状态具有一个编排 owner。
- Kargo controller 与 webhook 增加约 300m CPU、512Mi 内存的请求配置；这是调度请求，不代表实际使用量。
- 旧 workflow 和状态实现退役；步骤内的等待和重试通过 Kargo step retry/reconcile 语义完成。
- Failed/Errored Promotion 是终态，refresh 不会重跑；PromotionTask 步骤在创建时展开，修正 Stage 后也
  不会进入已有 Promotion。修复后为同一 Freight 新建 Promotion，成功 action 可复用。
- 选版 PR 等待 `validate` 最长 60 分钟；检查失败时修复并重跑 `validate` 后新建 Promotion。
- Kargo 版本约束跨稳定 1.x 的次版本，升级时继续由实际 chart 生成 schema；跨主版本需要重新评估合同。
