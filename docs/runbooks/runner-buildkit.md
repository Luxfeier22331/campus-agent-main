---
doc_type: runbook
owner_boundary: ci/runner-operations
status: active
---

# CI Runner 与 BuildKit

## 执行器选择

源码仓库默认使用 GitHub-hosted Runner：普通任务使用 `ubuntu-24.04`，ARM64 镜像发布使用
`ubuntu-24.04-arm`。过去因 GitHub-hosted 账单限制临时切换过 self-hosted；为保留同类故障下的人工
恢复能力，四个源码工作流读取仓库变量 `CI_RUNNER_MODE`：

- 变量未设置时使用 GitHub-hosted Runner；
- 变量值为 `self-hosted` 时使用 `self-hosted`、`Linux`、`campus-ci` 三个标签；
- 不自动 fallback、不双跑，也不为两类 Runner 维护两套工作流。

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
在工作流内初始化 Buildx，不消费 self-hosted Runner 的 builder 配置。

## 能力探针

备用 Runner 的探针入口是 `scripts/ci/runner-capability-probe.sh`。它会检查 Docker、runner-owned builder 的
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
重启 Docker、删除 builder 或清理缓存。`nc-arm-6c` 的现有 builder state 默认保留。只有确认目标
builder 无任务且缓存可丢弃时，才精确删除并重建该 builder，然后重新运行能力探针。

源码工作流不引用 CPU 或主机专属标签。备用 Runner 故障时先删除 `CI_RUNNER_MODE` 恢复 hosted 默认，
再修复 Runner 服务并按本手册验证 builder；不得将 `campus-ci` 添加到未通过探针的 Runner。

`CI_RUNNER_MODE` 只由源码仓库的 CI/发布工作流消费，用于账单或平台故障时的人工切换，不建立新的信任
边界。若 self-hosted Runner 被正式退役或不再维护，应删除该变量入口和本节备用流程。
