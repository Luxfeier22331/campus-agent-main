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

保留 `cache_write` 专用入口及 PR 关闭清理的部分已由新决定取代；host build 去重、缓存 warning 和 GitOps 校验所有权仍有效。
见[候选复用与镜像清理边界](./2026-10-03-source-publication-retention.md)。

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

镜像构建阶段的外网依赖只保留基础镜像、包仓库和 Go module 下载，并由 BuildKit cache mount 复用：

- 所有调用 pnpm 的 `RUN` 都挂载 `corepack` 缓存。cache mount 不进入镜像层，未挂载时 build 步骤
  会重新向 npm 下载 pnpm；2026-10-22 #666 的镜像证据因此两次被 registry 503 打断。
- Dockerfile 不声明 `# syntax=docker/dockerfile:1`，使用 builder 内置 frontend；现有指令均在内置
  frontend 支持范围内，构建带 `--pull` 时不再为每个镜像解析 Docker Hub frontend 镜像。
- runtime 阶段的 apt 命令挂载 `apt-cache` 和 `apt-lists`，执行期间临时移走 Debian 的
  `docker-clean`，结束后放回，最终镜像的 apt 配置和列表目录与改动前一致。基础镜像更新后，
  包下载可复用，QEMU 下的 dpkg 执行时间不变。
- Go 服务的 Debian runtime 前缀使用同一条指令，同一次发布只执行一次；Node runtime 先执行
  共同的 apt 指令，再设置各自的 `WORKDIR`、环境变量和标签。

main 发布的 canonical registry cache 使用 `mode=min`，只导出最终镜像层。`mode=max` 会导出
pruner、build 和 production-dependencies 等全部中间阶段，每个镜像 313–681MB；最近发布中
cache 导出合计长于构建本身（2026-10-21 全量发布导出 581s、构建 343s）。唯一 self-hosted builder
的本地缓存通常命中中间阶段，registry cache 只在本地缓存失效时补位；此时 runtime 层仍可命中，
中间阶段在 QEMU 下重建，单个 Node 镜像约多 30–80s。cache tag 不变，旧 max cache blob 由既有
GHCR retention 清理。

因此 `sq-nixos` builder 的 `maxUsedSpace` 从 12GB 提到 30GB。2026-10-22 一次全量 PR 构建后本地缓存
12.8GB：各 Node 镜像的完整 install、`--prod` install 和 runtime 复制各存一份 node_modules，合计约 5GB，
升级前的旧基础镜像约 2.4GB 仍未淘汰。根分区剩余约 120GB，`minFreeSpace = 25GB` 继续兜底。
每周维护只按 `until=168h` prune；原先叠加的容量参数让 prune 在占用低于上限时直接结束，连续六周
清理 0B。

## 未采用方案

- **把 PR cache 直接交给 main 发布**：PR 工作流的权限与信任边界不同，且 cache 不是可部署制品；
  继续使用 canonical main cache 作为可信加速输入。
- **让 cache export 失败阻塞发布**：缓存只影响速度，阻塞会把 registry 加速故障扩大为发布故障；
  选择可见 warning 与正式制品状态分离。
- **跳过所有 host build**：没有 Dockerfile 覆盖的 workspace 仍需要 host build 证据；
  只按已选 image target 精确去重。
- **保留 `mode=max` 但仅在本地未命中时导出**：需要解析 BuildKit 命中状态决定是否导出，逻辑和失败
  场景复杂；`mode=min` 已去掉主要导出量。
- **停止 registry cache 导出**：builder 重建或 GC 后完全无远端缓存，hosted 和 fork PR 也失去导入源。
- **固定 frontend 镜像 digest**：仍需访问 Docker Hub，内置 frontend 已满足当前指令。
- **合并 model-config 的 Go module 缓存 id**：Go 构建步骤最近只占 20–30s，不改变构建边界。

## 后果

PR 默认不再产生 per-PR registry cache，关闭 PR 后的旧 cache 仍由既有清理 owner 处理。main 发布
仍为 Source SHA 重新构建并推送不可变镜像；canonical cache 继续按镜像独立维护。Dockerfile 覆盖的
workspace 不再在 affected Node lane 中额外编译，`build:worker` 和测试不受影响。

若镜像构建迁到不保留本地缓存的 hosted runner，应按实测重新评估 `mode=max`。

缓存导出状态会进入 BuildKit phase summary 和 GitHub warning；未知或未完成的 BuildKit 输出仍按
现有规则保留为 unknown/unfinished。promotion 创建的 GitOps PR 不再在 Source job 中重复执行完整
Kustomize/ops-web render，GitOps validate 失败仍会阻止其后续合并。
