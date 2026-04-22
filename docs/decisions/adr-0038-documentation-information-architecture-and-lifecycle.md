---
doc_type: decision
decision_id: ADR-0038
status: accepted
created: 2026-04-12
updated: 2026-04-22
---
# ADR-0038 Documentation Information Architecture And Lifecycle

## 状态

Accepted on 2026-04-12.

## 背景

`campus-agent` 的架构方向已经基本稳定，但文档系统出现了明显漂移：

- `README.md` 与 `docs/README.md` 逐渐退化成超长入口清单
- `docs/plans/` 中存在明显已完成或只剩历史价值的文档，却仍保留 `active`
- `docs/` 与 `.planning/` 的边界虽然口头存在，但入口页没有持续执行
- ADR 基本只有 `accepted`，缺少更清晰的 lifecycle 语义
- 某些 plan 正文仍保留 agent/tool 专属协作噪音，而不是长期可引用内容

这种状态会带来几个直接问题：

- 新人很难判断“当前真相”与“历史基线”的区别
- 计划文档会被误读成 merged truth
- 已完成 closeout 的计划长期占用默认阅读路径
- 文档入口越长越难维护，最终没有人真正更新

## 决策

### 决策 1：默认入口收敛为少量 canonical 起点 + 分区 landing page

根 `README.md` 与 `docs/README.md` 不再平铺整个文档树。

默认入口固定收敛为：

- 产品定位
- 当前架构
- 目标架构
- 分区 landing pages
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

具体子类内容通过各分区 `README.md` 导航，而不是继续在根入口堆长列表。

### 决策 2：文档系统采用“按用户需求分工、按系统边界组织”的信息架构

当前 repo 文档分工固定为：

- `architecture/`、`decisions/`
  - explanation-oriented 系统边界与长期决策
- `contracts/`、`data/`、`reference/`
  - reference-oriented 稳定真相
- `runbooks/`
  - how-to oriented 可重复操作步骤
- `docs/plans/archive/`
  - archived implementation snapshots、supporting references 与 superseded
    predecessor
- `.planning/`
  - live execution state、native workstream entry、phase artefacts 与
    worktree-local execution context

这意味着：

- `plans/` 不承担当前 merged truth
- `.planning/` 不承担长期 canonical architecture index
- `reference/` 不承担 phase 状态

### 决策 3：状态语义按文档类型分开治理

文档状态不再全仓库共用一套含混 vocabulary。

固定状态集：

- `decision`
  - `proposed`
  - `accepted`
  - `superseded`
  - `deprecated`
- `plan`
  - `active`
  - `deferred`
  - `completed`
  - `historical`
  - `superseded`
- `reference`、`runbook`
  - `active`
  - `historical`
- 其他 canonical 文档类型
  - `active`

补充规则：

- 文档 front matter 的 `status` 只表达该文档自己的 lifecycle，不表达 repo 级 workstream registry
  state
- `.planning/WORKSTREAMS.md` 中的 `active / deferred / backlog / legacy` 是
  planning registry 语义，不是 `docs/plans/*.md` 的第二套 front matter 枚举
- 因此 backlog entry plan 继续使用 `status: deferred`；`backlog` 只在
  registry、索引说明和正文解释里出现，不新增为 plan front matter status

### 决策 4：已完成或历史性计划必须退出默认阅读路径

native workstream 的 live entry 固定迁到 `.planning/workstreams/<slug>/README.md`。

`docs/plans/` 不再承载 active / deferred workstream entry；根层只保留索引页，archive namespace
默认分成：

- `completed`
- `historical`
- `superseded`

这些 archived plan 不再进入根入口与默认阅读路径。

`docs/plans/README.md` 只负责解释 archive contract，不再扮演 repo 级 active/deferred
workstream registry。

当 archived plan 累积到会污染根层命名空间时，应优先物理下沉到 `docs/plans/archive/`，而不是继续让根层目录承担
archive 角色。

历史证据型 `reference` 和历史操作型 `runbook` 可以继续保留在 `docs/` 下，但必须：

- 显式标记为 `historical`
- 退出根入口的默认阅读路径
- 由对应分区 landing page 承担说明和聚合
- 当 volume 已足以影响根层可读性时，进一步物理下沉到各自 `archive/` 子目录

### 决策 5：ADR 不删除旧决策，而是显式 supersede

如果长期边界发生变化：

- 旧 ADR 继续保留
- 旧 ADR 标记为 `superseded` 或 `deprecated`
- replacement ADR 必须显式回链

禁止继续用“悄悄改旧文正文”替代 lifecycle。

### 决策 6：长期文档中不得保留 agent/tool 专属执行提示

长期文档可以写操作规则、架构边界和验收标准，但不得保留：

- `For Claude`
- `REQUIRED SUB-SKILL`
- 特定 agent 的一次性执行提示

这类协作信息只属于当轮执行产物，不属于 repo 的长期 source of truth。

## 结果

本 ADR 接受后，仓库应逐步完成以下收口：

- 根 `README.md` 与 `docs/README.md` 缩回真正的入口页
- 顶层文档分区补齐 `README.md`
- native workstream entry 统一回到 `.planning/workstreams/<slug>/README.md`
- `docs/plans/` 收口为 archive-only namespace
- 后续文档清理按 lifecycle 继续推进，而不是继续向入口页堆内容

## 关联文档

- `docs/README.md`
- `docs/architecture/current-architecture.md`
- `docs/plans/README.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`
