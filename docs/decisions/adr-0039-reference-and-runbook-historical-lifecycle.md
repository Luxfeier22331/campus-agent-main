---
doc_type: decision
decision_id: ADR-0039
status: accepted
created: 2026-04-12
updated: 2026-04-12
---

# ADR-0039 Reference And Runbook Historical Lifecycle

## 状态

Accepted on 2026-04-12.

## 背景

`ADR-0038` 已经把 `docs/` 与 `.planning/` 的分工、landing page 结构和 plan lifecycle 明确下来，但当前仓库又暴露出一个新的治理缺口：

- `reference/` 里存在大量一次性 release evidence、历史验收记录和旧 baseline 对照文档
- `runbooks/` 里存在历史 donor intake、legacy closeout 等仍需保留但不应再作为默认执行入口的文档
- 如果 `reference` 与 `runbook` 只能使用 `active`，这些文档就会继续伪装成当前默认真相

这会带来两个直接问题：

- landing page 很难把“当前可直接执行/引用的文档”与“只保留追溯价值的文档”分开
- 历史证据和历史流程会继续占用默认阅读路径，削弱当前 operator 文档的可用性

## 决策

### 决策 1：`reference` 与 `runbook` 允许使用 `historical`

除 `active` 外，以下文档类型现在也允许使用 `historical`：

- `reference`
- `runbook`

`historical` 语义：

- 文档仍然保留在 `docs/` 中
- 文档仍可作为追溯、审计、对照或迁移背景材料被引用
- 文档不再代表默认当前真相、默认当前执行入口或默认当前 baseline

### 决策 2：historical reference/runbook 必须退出默认阅读路径

顶层 landing page 与分区 landing page 必须把 `historical` 文档单独分组。

这意味着：

- 默认阅读分组优先只列 `active`
- 历史 evidence、legacy runbook、旧 baseline 对照文档进入单独的 `Historical` / `Archive` 分组
- 除非用户明确需要追溯或对照，否则 agent 不应把 historical 文档当成第一入口

### 决策 3：historical 不是删除，也不是 superseded

对 `reference` / `runbook` 而言：

- `historical` 表示“仍保留，但不再是默认当前入口”
- 不要求像 ADR 一样必须有 replacement 文档
- 如果某份 historical 文档确实已被明确 replacement 完整替代，仍可在正文中写出 replacement

### 决策 4：时间戳证据和 legacy workflow 优先考虑 historical

以下信号出现时，应优先考虑标记为 `historical`：

- 标题本身就是一次性日期 evidence
- 文档描述的对象已经完成 closeout
- 文档正文明确写出“不再是默认执行入口”“legacy workflow”“historical baseline”
- 当前 merged truth 或当前 active lane 已经转移到其他 canonical 文档

## 结果

本 ADR 接受后，仓库应逐步完成以下收口：

- `docs/README.md` 明确 `reference/runbook` 也允许 `historical`
- `reference/README.md` 与 `runbooks/README.md` 把当前入口和历史材料分开
- 明显已经退出默认执行面的历史 evidence / runbook 改成 `historical`

## 关系

This ADR complements:

- `docs/decisions/adr-0038-documentation-information-architecture-and-lifecycle.md`

