---
doc_type: runbook
owner_boundary: ci/runner-operations
status: active
---

# CI Runner 与 BuildKit

## 能力合同

本仓库工作流统一使用 `self-hosted`、`Linux`、`campus-ci` 三个标签。`campus-ci` 表示该 Runner
已经通过能力探针，且能使用 runner-owned Buildx builder 生成 `linux/arm64` 制品；它不表示某一种
CPU、虚拟化方式或主机名。

目标是让两个 Runner 对 CI 暴露同一合同。下表同时标出当前验证状态；未通过探针的 Runner 不得添加
`campus-ci`：

| Runner | 目标架构实现 | Builder | 验证状态 |
| --- | --- | --- | --- |
| `nc-arm-6c` | 原生 ARM64 | `campus-agent-release` | 已通过真实 arm64 OCI 探针 |
| `sq-nixos` | x86_64 + NixOS binfmt/QEMU | `campus-runner-buildkit-v1` | 待 SSH/主机网络恢复后验证 |

Runner 服务为作业注入 `HOME`、`DOCKER_CONFIG` 和 `BUILDX_BUILDER`。工作流不得使用
`docker/setup-buildx-action`、`docker/setup-qemu-action`，也不得创建临时 builder。

## 能力探针

探针入口是 `scripts/ci/runner-capability-probe.sh`。它会检查 Docker、runner-owned builder 的
运行状态和 `linux/arm64` 平台、根文件系统至少 25GB 可用空间，并使用 `scratch` Dockerfile 输出
OCI 制品后检查其 OCI platform 元数据。

在对应 Runner 用户环境中执行：

```bash
BUILDX_BUILDER=campus-agent-release \
HOME=/home/github-runner \
DOCKER_CONFIG=/home/github-runner/.docker \
scripts/ci/runner-capability-probe.sh
```

`sq-nixos` 使用 `/var/lib/github-runner` 作为 `HOME` 和 Docker 配置目录。服务启动前必须通过同一
探针；失败时 Runner 不接收任务。

## BuildKit 容量治理

目标配置中两个 builder 都使用以下 BuildKit GC 上限；目前已在 `nc-arm-6c` 的实际 builder 上确认：

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

## 变更与恢复

修改 builder 配置前先确认 GitHub Runner `busy=false`，并停止对应 Runner 服务；不要在有作业运行时
重启 Docker、删除 builder 或清理缓存。`nc-arm-6c` 的现有 builder state 默认保留。只有确认目标
builder 无任务且缓存可丢弃时，才精确删除并重建该 builder，然后重新运行能力探针。

旧的 CPU 标签在灰度期间保留，但源码工作流不再引用它们。灰度失败时先恢复 Runner 服务和
`campus-ci` 标签，再按本手册验证 builder；不得通过切换到未经探针验证的默认 builder 绕过故障。
