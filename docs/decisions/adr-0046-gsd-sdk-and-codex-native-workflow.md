---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0046
status: accepted
created: 2026-06-04
updated: 2026-06-08
---
# ADR-0046 GSD SDK And Codex Native Workflow

## 状态

Accepted on 2026-06-04. Updated on 2026-06-08 to reflect the repo cleanup that
removed tracked workstream/phase/archive directories from branch tip.

## 背景

`campus-agent` 曾维护 repo-owned workstream harness，用于包装 Codex 执行、
terminal-result artifact、claim lease、heartbeat ledger 与 hook 注入。随着 GSD SDK 与
Codex 原生命令面成熟，这套 repo-local execution substrate 开始重复外部工具能力，并带来
额外维护成本：

- repo 需要维护自己的 wrapper、schema、hooks、tests 与 runtime ledger
- tracked planning truth 与本地 session/runtime state 容易混在一起
- workstream 状态、执行现场、review、debug 与 closeout 边界不够清楚
- 本地 hook 与 wrapper 容易在 Windows / WSL / remote host 间产生漂移

当前已确认的工具边界：

- GSD SDK 提供 workstream、state、roadmap、phase、requirements、progress、
  validate、verify、gap-analysis、worktree、commit 等 planning / workflow
  control-plane 能力
- Codex 提供交互执行、`exec`、`review`、`apply`、`resume`、`fork`、
  MCP、plugin、sandbox、approval、profile、model 与 search 等 execution runtime
  能力

## 决策

### 决策 1：GSD SDK 是 workstream planning control plane

repo 级 workstream registry、active workstream、progress、status、create 与 complete
操作由 GSD SDK 承担。

默认命令入口、参数形态与日常操作步骤由
`docs/runbooks/workstream-gsd-sdk-workflow.md` 维护；本 ADR 只冻结 owner
boundary。

Tracked planning truth 只保留在：

- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

GSD SDK / Codex native sessions own live workstream/session state. If a decision
needs to persist beyond the session, promote it to docs / ADR / runbook /
contract / schema, or to the compact planning files above.

### 决策 2：Codex 原生会话是 execution runtime

讨论、架构辨析、实现、debug、review、测试与 closeout 由 Codex 原生命令承担。

默认命令入口、执行控制参数与日常使用方式由
`docs/runbooks/workstream-gsd-sdk-workflow.md` 维护；本 ADR 不复制可执行命令清单。

Codex 本地 session 只代表执行现场，不代表 repo truth。需要长期保留的信息必须进入
docs、planning、commit、PR 或 evidence artifact。

### 决策 3：repo 不再维护自建 workstream harness

repo 不再恢复或新增以下能力：

- repo-owned workstream harness wrapper
- terminal-result JSON artifact contract
- claim lease / heartbeat ledger
- repo-local Codex hook 注入
- handoff runtime ledger
- 本地 session state 写回 tracked planning

发现旧入口残余时，应删除残余并回到
`docs/runbooks/workstream-gsd-sdk-workflow.md`。

### 决策 4：需求与架构变更按 truth layer 路由

未来工作按以下规则路由：

- 新需求：小任务直接 Codex；跨模块或长期任务创建 / 恢复 workstream
- 需求变更：先在 GSD SDK / Codex session 中更新工作上下文；长期 contract 变化必须进入
  docs / ADR / runbook / schema，再改实现
- 已完成功能变更：按当前 owner area 判断恢复工作或创建新工作，不恢复旧 tracked phase tree
- 新架构评估但未实现：写入 proposed / accepted ADR、architecture note 或 runbook handoff；
  不得冒充 current implementation truth
- 架构约束变更：先更新 ADR / architecture / contracts，再推进实现 workstream
- 文档漂移：先判断 source of truth，再同步 docs 或代码

### 决策 5：runbook 是操作手册，ADR 是决策真相

`docs/runbooks/workstream-gsd-sdk-workflow.md` 记录具体操作命令和日常流程。
本 ADR 记录长期边界与不再恢复旧 harness 的决策。

## 后果

- repo workflow substrate 更轻，避免维护第二套 agent runtime
- GSD SDK 与 Codex 可以独立升级，repo 只维护项目 truth
- workstream status 与本地执行现场分离，减少 tracked planning 污染
- 多人并发需要继续靠 branch / worktree / planning truth 协调，而不是 repo-local
  claim lease
- Codex session 中的重要结论必须显式沉淀到 docs、ADR、runbook、contract、schema、compact
  planning、commit、PR 或 evidence，
  否则不构成 repo truth

## 验证口径

旧 harness 可执行入口不应再次出现在 tracked repo 中。具体检查命令、操作顺序与
closeout 步骤由 `docs/runbooks/workstream-gsd-sdk-workflow.md` 维护，避免 ADR
复制 runbook 职责。

## 关联文档

- `docs/runbooks/workstream-gsd-sdk-workflow.md`
- `.planning/WORKSTREAMS.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
