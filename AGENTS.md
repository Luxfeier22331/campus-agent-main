# AGENTS.md

## 入口

- 仓库概览与常用命令：`README.md`
- 文档入口与所有权：`docs/README.md`
- 本文件只保留每次任务都需要的规则；修改结构或接口前，只读取直接相关的最近 README、架构、合同、
  数据文档或 ADR。

## 工作范围

- 修改前确认当前 worktree 和分支；用户指定 worktree 时，先运行 `git worktree list --porcelain`
  定位，再在目标路径运行 `git status --short --branch`。未经要求不得撤销其他改动，改动只覆盖用户
  要求的所有者。
- 新建 linked worktree 只放在主 checkout 根目录的 `.worktrees/<name>`；不得在 linked worktree 内
  嵌套创建，也不得新建仓库外的 sibling worktree。现有 worktree 不因此自动迁移。

## 工具约定

- 搜索使用 `rg` / `rg --files`；Node/Worker 工作使用 `pnpm`；不得添加或维护 `package-lock.json`。
