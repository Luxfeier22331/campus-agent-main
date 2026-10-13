# Agent Note: Worker 发布闭环迁入 GitOps

Status: implemented

## 背景

Worker 构建依赖 GitOps 的 Docs 快照和公开环境值。Source 等待 GitOps 准备输入时会占住共享 runner；
输入虽然成功发布，Source 的 workflow token 仍无法读取 GitOps 私有 GHCR package。
继续增加跨仓 package 授权会让应用发布依赖另一个仓库的输入包访问设置。

## 决策

候选交接、恢复与编排后续由[无 UI Kargo 发布编排](2026-10-13-kargo-headless-release.md)取代：
完整 OCI candidate 取代短期 artifact 交接，Kargo 取代旧 deployment coordinator；本文的仓库、
凭据及 registry 清理 owner 边界仍有效。

Source 保留源码验证、累计受影响计划和镜像发布，将已经计算的计划与镜像 producer run 作为短期
Actions artifact 交给 GitOps。交接需要保留同 SHA 的显式 Worker 刷新选择，因此不能只传 SHA
再根据源码 diff 重算。Source 用 App 的 Actions write 异步触发 GitOps，不轮询下游完成。

GitOps 校验 main 发布 workflow、计划中的 SHA、镜像发布 job 与必需 digest。交接时 Source run
可能仍在执行 dispatch，因此以已完成的 producer job 为依据，不要求整个 run 已结束。
GitOps checkout 精确 Source SHA，使用 Source 构建脚本准备 Docs 快照、Worker bundle，在自有 GHCR
保存 digest 固定的制品。对象存储凭据只进入快照步骤，公开构建值进入编译步骤。

异步交接按 release 游标去重。前一发布推进游标后，普通 Source 重跑重新计算累计范围，复用所需
镜像并交接新计划；不能因旧 dispatch 成功而跳过。新范围需要此前没有发布的镜像时正常发布。
GitOps 保留游标一致性检查，过期计划提示重跑 Source，而不是重复执行同一旧计划。

候选完成后由 GitOps 写 staging/candidate 成功状态，调用既有 promote-source 生成 deploy/staging PR。
构建与 promotion 是独立 job；只重跑失败的 promotion 可复用本次候选，Source recovery 只复用镜像并
保留 Worker 选择，Worker 重新发布由 GitOps 执行。原生版本上传、Terraform 流量、Deployment 恢复
与正式版本回滚继续复用既有 owner，不在新 workflow 复制。

删除跨仓 worker-input 包生产与下载路径。Source 的 registry 清理只登记其拥有的镜像，不读取、写入
或清理 GitOps Worker package。混合保留根在 Source 消费入口按仓库过滤，自己的未登记 package
仍然失败；本次不新建 GitOps package 清理策略。

本篇部分取代[集群私有入口与 Worker 凭据边界](../architecture/2026-10-11-cluster-private-ingress.md)
中的 Source 构建 bundle 决定；入口、凭据和原生版本部署边界保持有效。同时调整
[候选复用与镜像清理边界](2026-10-03-source-publication-retention.md)的 Worker 候选与恢复 owner。

## 未采用方案

继续授权 Source 读取 GitOps 的输入 package，能够保留 Source 的原构建 job，但会维持跨仓 registry
依赖和 runner 等待环。将环境输入与 Worker 构建放在 GitOps 内可直接消除这两个已观察到的失败点。

将 Cloudflare 上传和流量应用复制到构建 workflow，能减少入口数量，但会形成第二个部署 owner。
保留 promotion PR 和既有 deploy workflow，继续区分候选构建成功与部署完成。

## 后果

Worker 发布故障在 GitOps 排查，Source pipeline 成功只表示镜像和交接完成。GitOps 候选 artifact
沿用七天保留；过期后显式重新发布，不新增发布数据库或长期恢复副本。

迁移需先合并 GitOps 接收入口，再合并 Source 交接，随后触发新 Source 发布验证真实凭据与 registry
读写。本地测试覆盖交接身份、镜像复用、空候选、打包与工作流依赖，不代替合并后的供应商验收。
