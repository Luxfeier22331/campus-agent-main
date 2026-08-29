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
