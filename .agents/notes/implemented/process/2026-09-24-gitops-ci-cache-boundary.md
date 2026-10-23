# Agent Note: GitOps CI 依赖缓存边界

Status: implemented

## 背景

GitOps 的 validate、promotion、deployment 和 credential identity workflow 都会独立执行 pnpm
安装。Terraform provider cache 已按 root 和 lockfile 隔离，不能与 Node 依赖共用。

## 决策

所有包含 pnpm 安装的 GitHub workflow job 在 hosted runner 上使用同一份 `RUNNER_TEMP/pnpm-store` cache，cache key 由操作系统、架构和 `pnpm-lock.yaml` 决定；安装前显式设置 pnpm store-dir。self-hosted runner 使用其本地工具缓存，不新增 Actions cache。

Terraform provider cache 继续由 deploy 的五个 Terraform root 独立维护，key 绑定对应
`.terraform.lock.hcl`，不与 pnpm cache 合并。

现有 Argo 通知触发器合同保持不变。`oncePer` 的扩展没有实际故障依据，且会与
`policy/kubernetes/notifications.rego` 的健康恢复要求分叉，因此不在本次缓存治理中改变通知语义。

## 未采用方案

- 把所有 Terraform lockfile 合并为一个 provider cache：不同 root 的 provider 集合和锁文件边界不同，
  合并会扩大失效范围。
- 继续让每个 job 使用默认 pnpm store：会重复下载依赖，且无法在 workflow 间复用。
- 为了支持未经证明的通知去重语义而放宽 Kubernetes policy：现有 policy 已是通知合同，本次没有实际故障
  要求改变它。

## 后果

Hosted GitOps job 的依赖安装可以跨 workflow 复用内容寻址 store；锁文件变化会自然生成新 cache。
不同 Terraform root 仍保持独立失效边界。通知行为继续由现有 values、policy 和测试共同约束。
