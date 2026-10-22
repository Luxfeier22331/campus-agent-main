---
doc_type: runbook
owner_boundary: ci/runner-operations
status: active
---

# CI Runner 与 BuildKit

## 执行器选择

源码仓库的六个执行工作流读取仓库变量 `CI_RUNNER_MODE`：`pr.yml`、`pr-image-evidence.yml`、
`staging-candidate-publish.yml`、`manual-evidence.yml`、`dependencies.yml` 和 `ghcr-retention.yml`。
当前两个仓库都将该变量设置为 `self-hosted`，因此作业默认运行在已注册并通过能力探针的 self-hosted
Runner（当前只有 `sq-nixos`）。为保留平台故障下的人工恢复能力，变量仍支持切换到 GitHub-hosted Runner：

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

在 Runner 用户环境中执行：

```bash
BUILDX_BUILDER=campus-runner-buildkit-v1 \
HOME=/var/lib/github-runner \
DOCKER_CONFIG=/var/lib/github-runner/.docker \
bash scripts/ci/runner-capability-probe.sh
```

服务启动前必须通过同一探针；失败时 Runner 不接收任务。并发检查读取 Buildx 注册节点的
`buildkitd.toml`，不以宿主机上尚未应用的配置文件作为已生效的证据。

## BuildKit 容量治理

builder 的 BuildKit daemon 配置负责容量 GC：

- `maxUsedSpace = 30GB`；
- `minFreeSpace = 25GB`；
- `reservedSpace = 2GB`。

PR 镜像证据不导出 registry cache，main 发布的 registry cache 只含最终镜像层，中间阶段依赖本地缓存；
一次全量构建的 node_modules 层约 6GB，上限需容纳多次构建。

每周的 builder-scoped 维护只对对应 builder 执行 `buildx history rm` 和
`buildx prune --filter until=168h`，清理 7 天未使用的记录，例如基础镜像升级后的旧层。维护不叠加容量参数：
容量参数让 prune 在占用低于上限时直接结束，不会删除过期记录。禁止使用不带 `--builder` 的全局 prune，
也不执行 `docker system prune` 或 `docker volume prune`。

检查实际 builder，而不是 Docker CLI 的默认 builder：

```bash
sudo -u github-runner env \
  HOME=/var/lib/github-runner \
  DOCKER_CONFIG=/var/lib/github-runner/.docker \
  BUILDX_BUILDER=campus-runner-buildkit-v1 \
  docker buildx inspect --bootstrap

sudo -u github-runner env \
  HOME=/var/lib/github-runner \
  DOCKER_CONFIG=/var/lib/github-runner/.docker \
  BUILDX_BUILDER=campus-runner-buildkit-v1 \
  docker buildx du
```

## Self-hosted 维护

修改 builder 配置前先确认 GitHub Runner `busy=false`，并停止对应 Runner 服务；不要在有作业运行时
重启 Docker、删除 builder 或清理缓存。维护期间暂停该 builder 的 GC timer，并确认 GC service 已结束。

`sq-nixos` 的 builder 由 NixOS 配置管理，初始化入口是 `campus-runner-buildkit.service`，
定时维护是 `campus-runner-buildkit-gc.timer`；Runner 服务启动前运行能力探针。
builder 只在创建时读取 `buildkitd.toml`。初始化服务比较容器中的 `/etc/buildkit/buildkitd.toml` 与
NixOS 生成的配置，不一致时执行 `docker buildx rm --keep-state campus-runner-buildkit-v1`，再以相同名称和
更新后的 `--buildkitd-config` 重建；状态卷 `buildx_buildkit_campus-runner-buildkit-v10_state` 和缓存保留。
初始化服务重启会连带重启 Runner 服务，因此只在 Runner 空闲时执行 `nixos-rebuild switch`。

应用后核对容器中的 `/etc/buildkit/buildkitd.toml`、BuildKit 版本和 `/var/lib/buildkit` 仍挂载原状态卷，
再确认能力探针通过、Runner 重新上线。失败时执行 `nixos-rebuild switch --rollback`；状态卷保留，
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
