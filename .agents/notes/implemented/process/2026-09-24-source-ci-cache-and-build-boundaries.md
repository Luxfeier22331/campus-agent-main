# Agent Note: Source CI 缓存与镜像构建边界

Status: implemented

## 背景

PR 镜像证据使用 BuildKit `cacheonly`，而合并后的 Source main 发布才生成不可变镜像 digest。
PR 专属 `mode=max` registry cache 不被 main 发布直接消费，却在每个镜像上产生导出成本；同时受影响
Node workspace 的 host `build` 会在 PR 镜像的 Dockerfile 中再次编译同一 workspace。Source promotion
还曾在创建 GitOps PR 前完整渲染部署资源，完整静态渲染的 owner 实际是 GitOps PR validation。

这部分边界取代[镜像生产输入与 PR 增量构建](../testing/2026-09-19-image-production-inputs.md)
中“同仓 PR 默认导入并导出 PR cache”的范围；镜像选择、生产输入映射和历史运行基线仍然有效。

## 决策

- trusted 同仓 PR image evidence 默认只导入每镜像的 main canonical cache，不导出
  `pr-cache-<number>`；fork 和 Dependabot 继续不使用认证缓存。reusable workflow 保留显式
  `cache_read=true` / `cache_write=true` 作为专用调用入口。
- cache export 失败不阻塞已经成功的镜像构建或发布，但 `images.mts` 必须在日志与 step summary
  显式报告 warning；正式镜像 digest、扫描和 promotion 输入不依赖 cache export。
- affected Node evidence 保留 typecheck/test 和 `build:worker`；当同一变更选择了由 Dockerfile
  覆盖的 image target 时，跳过对应 workspace 的 host `build`，让 Docker image build 成为该 workspace
  的唯一编译入口。非镜像 workspace 的 `build` 继续执行。
- Source promotion 只保留 promotion 输入和结果的结构性合同校验；完整 GitOps render 与 policy
  validation 由 GitOps PR validation owner 执行。

## 未采用方案

- **把 PR cache 直接交给 main 发布**：PR 工作流的权限与信任边界不同，且 cache 不是可部署制品；
  继续使用 canonical main cache 作为可信加速输入。
- **让 cache export 失败阻塞发布**：缓存只影响速度，阻塞会把 registry 加速故障扩大为发布故障；
  选择可见 warning 与正式制品状态分离。
- **跳过所有 host build**：没有 Dockerfile 覆盖的 workspace 仍需要 host build 证据；
  只按已选 image target 精确去重。

## 后果

PR 默认不再产生 per-PR registry cache，关闭 PR 后的旧 cache 仍由既有清理 owner 处理。main 发布
仍为 Source SHA 重新构建并推送不可变镜像；canonical cache 继续按镜像独立维护。Dockerfile 覆盖的
workspace 不再在 affected Node lane 中额外编译，`build:worker` 和测试不受影响。

缓存导出状态会进入 BuildKit phase summary 和 GitHub warning；未知或未完成的 BuildKit 输出仍按
现有规则保留为 unknown/unfinished。promotion 创建的 GitOps PR 不再在 Source job 中重复执行完整
Kustomize/ops-web render，GitOps validate 失败仍会阻止其后续合并。
