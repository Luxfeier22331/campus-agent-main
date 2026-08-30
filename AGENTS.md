# AGENTS.md

## 入口

- 仓库概览与常用命令：`README.md`
- 文档入口与所有权：`docs/README.md`
- 本文件只保留每次任务都需要的规则；修改结构或接口前，只读取直接相关的最近 README、架构、合同、
  数据文档或 ADR。

## 判断边界

- 分析、解释、方案和实现都必须绑定到当前操作、实际消费者、所有权和完成标准。用户的上下文用词、
  代码命名、错误码或通用行业术语不能单独证明一个领域概念、系统职责或新增需求。
- 只提出会改变当前判断、方案或完成标准的风险和限制；不得用通用最佳实践、理论 caveat 或相邻能力
  扩大问题范围。实现命名与实际行为或最近合同冲突时，应指出命名问题并以实际调用链和合同为准。

## 工作范围

- 修改前确认当前 worktree 和分支；用户指定 worktree 时，先运行 `git worktree list --porcelain`
  定位，再在目标路径运行 `git status --short --branch`。未经要求不得撤销其他改动，改动只覆盖用户
  要求的所有者。
- 新建 linked worktree 只放在主 checkout 根目录的 `.worktrees/<name>`；不得在 linked worktree 内
  嵌套创建，也不得新建仓库外的 sibling worktree。现有 worktree 不因此自动迁移。

## 工具约定

- 搜索使用 `rg` / `rg --files`；Node/Worker 工作使用 `pnpm`；不得添加或维护 `package-lock.json`。

## 机制准入

- 当变更新增持久化状态、数据生命周期约束、manifest/hash/version/immutable、append-only/history/
  recovery、retry/fallback/wrapper/config flag、权限隔离、脱敏、质量阈值/gate，或拆分 PR、issue、
  worktree 时，实施计划或变更说明必须说明：需求或已有合同来源、当前真实消费者和 owner、已观察到的
  失败或信任边界、现有 owner/字段/接口为何不足，以及删除或重新评估条件。任一项缺失时，默认修改
  现有 owner、报告问题或暂缓，不新增机制。
- 不得把 agent 自己提出的方案或文档当成外部需求来源。验证应检查行为和真实能力，不得用关键词黑名单
  全局禁止 retry、fallback、hash、manifest、immutable、QEMU 或权限隔离。
- 连续承接任务默认留在当前分支和 worktree。只有用户明确要求，或存在独立 owner、发布、回滚或权限
  边界时才拆分 PR、issue 或 worktree；不得自动创建空 issue。用户明确要求停止更新 issue、不脱敏或
  不拆分后，不得自行恢复这些动作。
