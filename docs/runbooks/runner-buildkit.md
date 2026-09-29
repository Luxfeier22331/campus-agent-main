---
doc_type: runbook
owner_boundary: ci/runner-operations
status: active
---

# CI Runner 与 BuildKit

## 执行器选择

源码仓库的六个执行工作流读取仓库变量 `CI_RUNNER_MODE`：`pr.yml`、`pr-image-evidence.yml`、
`execution-runtime-publish.yml`、`manual-evidence.yml`、`dependencies.yml` 和 `ghcr-retention.yml`。
当前两个仓库都将该变量设置为 `self-hosted`，因此作业默认运行在已注册并通过能力探针的 self-hosted
Runner（当前为 `nc-arm-6c`）。为保留平台故障下的人工恢复能力，变量仍支持切换到 GitHub-hosted Runner：

- 变量未设置时使用 GitHub-hosted Runner；
- 变量值为 `self-hosted` 时使用 `self-hosted`、`Linux`、`campus-ci` 三个标签；
- 不自动 fallback、不双跑，也不为两类 Runner 维护两套工作流。

GitHub-hosted 仅是删除 `CI_RUNNER_MODE` 后的人工 fallback，不是当前默认执行路径。

切换到备用 Runner：

```bash
gh variable set CI_RUNNER_MODE \
  --repo MUC-WIKI/campus-agent \
  --body self-hosted
```

恢复默认 Runner：

```bash
gh variable delete CI_RUNNER_MODE \
  --repo MUC-WIKI/campus-agent
```

`campus-ci` 表示 self-hosted Runner 已通过能力探针，且能使用 runner-owned Buildx builder 生成
`linux/arm64` 制品；它不表示某一种 CPU、虚拟化方式或主机名。未通过探针的 Runner 不得添加该标签：

| Runner | 目标架构实现 | Builder |
| --- | --- | --- |
| `nc-arm-6c` | 原生 ARM64 | `campus-agent-release` |
| `sq-nixos` | x86_64 + NixOS binfmt/QEMU | `campus-runner-buildkit-v1` |

Self-hosted Runner 服务为作业注入 `HOME`、`DOCKER_CONFIG` 和 `BUILDX_BUILDER`。源码工作流只依赖
这个能力合同，不判断 builder 是原生目标、QEMU/binfmt 还是其他宿主实现。GitHub-hosted 的镜像任务
在工作流内初始化 `docker-container` Buildx，BuildKit `max-parallelism=2`，不消费 self-hosted Runner
的 builder 配置。Self-hosted builder 同样必须在 `[worker.oci]` 中设置 `max-parallelism = 2`。
该限制约束 builder 内部构建操作；PR 镜像检查和候选发布按 heavy、standard 顺序逐个提交镜像，
等待当前镜像的构建与导出完成才处理下一个。分组不再代表一次多目标 Bake 调用。

## 能力探针

备用 Runner 的探针入口是 `scripts/ci/runner-capability-probe.sh`。它会检查 Docker、runner-owned builder 的
`docker-container` driver、运行状态和 `linux/arm64` 平台、节点配置中 `[worker.oci]` 的
`max-parallelism = 2`、根文件系统至少 25GB 可用空间，并使用
`scratch` Dockerfile 同时输出 OCI 制品和 `mode=max` 本地缓存，再检查 OCI platform 元数据和缓存
index。探针不删除或重建已有 builder；本地 exporter 验证不替代 GHCR 权限验收。

在对应 Runner 用户环境中执行：

```bash
BUILDX_BUILDER=campus-agent-release \
HOME=/home/github-runner \
DOCKER_CONFIG=/home/github-runner/.docker \
bash scripts/ci/runner-capability-probe.sh
```

`sq-nixos` 使用 `/var/lib/github-runner` 作为 `HOME` 和 Docker 配置目录。服务启动前必须通过同一
探针；失败时 Runner 不接收任务。并发检查读取 Buildx 注册节点的 `buildkitd.toml`，不以宿主机
上尚未应用的配置文件作为已生效的证据。

## BuildKit 容量治理

两个 builder 的当前配置和定时维护均使用以下 BuildKit GC 上限：

- `maxUsedSpace = 12GB`；
- `minFreeSpace = 25GB`；
- `reservedSpace = 2GB`。

BuildKit daemon 配置负责正常 GC，builder-scoped 的定时维护只对对应 builder 执行
`buildx history rm` 和 `buildx prune`。禁止使用不带 `--builder` 的全局 prune，也不执行
`docker system prune` 或 `docker volume prune`。

检查实际 builder，而不是 Docker CLI 的默认 builder：

```bash
sudo -u github-runner env \
  HOME=/home/github-runner \
  DOCKER_CONFIG=/home/github-runner/.docker \
  BUILDX_BUILDER=campus-agent-release \
  docker buildx inspect --bootstrap

sudo -u github-runner env \
  HOME=/home/github-runner \
  DOCKER_CONFIG=/home/github-runner/.docker \
  BUILDX_BUILDER=campus-agent-release \
  docker buildx du
```

`sq-nixos` 的路径和 builder 名称替换为上表中的值。

## Self-hosted 维护

修改 builder 配置前先确认 GitHub Runner `busy=false`，并停止对应 Runner 服务；不要在有作业运行时
重启 Docker、删除 builder 或清理缓存。维护期间暂停该 builder 的 GC timer，并确认 GC service 已结束。

`nc-arm-6c` 的配置源是 `/etc/campus-agent/buildkit.toml`，初始化入口是
`campus-agent-buildkit.service` 调用的 `/usr/local/lib/campus-agent/buildkit-ensure.sh`。
初始化只在 builder 不存在时加载配置；修改宿主机文件不会更新已有 builder。
初始化参数显式保留该主机的 2 CPU、2GiB 内存、无容器 swap 和现有 bridge 网络设置。

应用配置时先保存原配置、实际容器镜像 ID、资源限制及状态卷名称。以 Runner 用户对指定 builder 执行
`docker buildx rm --keep-state campus-agent-release`，然后使用相同 builder 与节点名称、现有 BuildKit
镜像和资源配置重新创建，传入更新后的 `--buildkitd-config`。不得删除状态卷或顺带升级 BuildKit。
核对容器中的 `/etc/buildkit/buildkitd.toml`、资源限制、版本和 `/var/lib/buildkit` 挂载仍使用原状态卷，
再运行能力探针。全部通过后恢复 GC timer 和 Runner 服务；失败时保留状态卷并恢复原配置，
在构建能力恢复前不接收新任务。

缓存导出失败继续作为发布摘要中的 warning；正式镜像推送失败阻断发布，不输出部分 digest 集合。
同一 SHA 重试仍复用已经验证的不可变镜像。若源码修复已合入 main，使用新 main 的正常发布，
不要重跑会被当前 main 校验拒绝的旧版本。

源码工作流不引用 CPU 或主机专属标签。备用 Runner 故障时先删除 `CI_RUNNER_MODE` 恢复 hosted 默认，
再修复 Runner 服务并按本手册验证 builder；不得将 `campus-ci` 添加到未通过探针的 Runner。

`CI_RUNNER_MODE` 只由源码仓库的 CI/发布工作流消费，用于账单或平台故障时的人工切换，不建立新的信任
边界。若 self-hosted Runner 被正式退役或不再维护，应删除该变量入口和本节备用流程。

## 相关文档

- [发布](./release/release.md)
- [GHCR 镜像保留](./release/ghcr-retention.md)
