---
doc_type: runbook
status: active
created: 2026-06-04
updated: 2026-06-04
---

# Workstream GSD SDK Workflow

当前 repo 的 workstream 操作由 GSD SDK 与 Codex 原生会话承担。
repo 不再维护自建 workstream harness、lease / heartbeat、Codex hook 注入或
terminal-result artifact。

本 runbook 记录当前开发工作流。它不是产品 runtime contract，也不是架构 ADR；长期
workflow 决策见 `docs/decisions/adr-0046-gsd-sdk-and-codex-native-workflow.md`。

## Scope

- `.planning/WORKSTREAMS.md` 是 repo 级 registry 总览。
- `.planning/workstreams/<slug>/README.md` 是单条 native workstream 的人工入口。
- `.planning/workstreams/<slug>/STATE.md` 记录 current slice、blockers、
  verification 与 continuity。
- GSD SDK 负责 workstream / milestone / phase / requirements / progress 等
  planning control-plane 操作。
- Codex 原生会话负责讨论、review、debug、执行、验证和 closeout。
- `docs/` 记录长期架构、contract、reference 与 runbook truth。
- `.planning/` 记录当前工作状态，不记录本地 session/runtime ledger。

## Capability Surface

本节只记录已通过本机命令面确认的能力类别。新增命令前先用
`gsd-sdk query --help` 或 `codex --help` 重新确认。

### GSD SDK

GSD SDK 是 planning control plane。

常用 workstream 命令：

列出 workstreams：

```bash
gsd-sdk query workstream.list --raw --cwd "$PWD"
```

查看单条 workstream：

```bash
gsd-sdk query workstream.status <workstream-slug> --raw --cwd "$PWD"
```

切换当前 workstream：

```bash
gsd-sdk query workstream.set <workstream-slug> --raw --cwd "$PWD"
```

查看整体进度：

```bash
gsd-sdk query workstream.progress --raw --cwd "$PWD"
```

创建 workstream：

```bash
gsd-sdk query workstream.create "<name>" --raw --cwd "$PWD"
```

完成 workstream：

```bash
gsd-sdk query workstream.complete <workstream-slug> --raw --cwd "$PWD"
```

其他能力类别：

- planning state：`state`、`roadmap`、`phase`、`phases`、`requirements`、
  `progress`
- quality and gap review：`validate`、`verify`、`verify-summary`、
  `gap-analysis`、`audit-open`、`audit-uat`
- project intelligence：`graphify`、`history-digest`、`learnings`、`intel`
- scaffolding and project support：`docs-init`、`scaffold`、`template`、
  `worktree`
- commit support：`check-commit`、`commit`

常用全局参数：

```bash
gsd-sdk query <command> --raw --cwd "$PWD"
gsd-sdk query <command> --pick <field> --cwd "$PWD"
gsd-sdk query <command> --ws <workstream-slug> --cwd "$PWD"
```

### Codex

Codex 是 execution runtime。

常用命令：

```bash
codex
codex exec "<task>"
codex review
codex apply
codex resume
codex fork
codex mcp
codex plugin
```

常用执行控制：

```bash
codex -C "$PWD"
codex -m <model>
codex -p <profile>
codex -s read-only
codex -s workspace-write
codex -a on-request
codex --search
```

`codex exec` 适合非交互批处理；`codex review` 适合提交前 review；
`codex resume` / `codex fork` 只恢复或分叉本地会话，不替代 tracked
planning truth。

## Source Of Truth Layers

- `docs/architecture/`
  - owner: repo docs
  - purpose: 长期架构与边界
  - not for: 当前任务进度
- `docs/decisions/`
  - owner: ADR
  - purpose: 已接受或被替代的长期决策
  - not for: 临时执行记录
- `docs/contracts/`
  - owner: contracts
  - purpose: API / runtime / data contract
  - not for: workstream 状态
- `docs/runbooks/`
  - owner: operations docs
  - purpose: 可重复操作步骤
  - not for: 架构决策替代品
- `.planning/PROJECT.md`
  - owner: planning
  - purpose: 当前项目级范围与关键状态
  - not for: 深层架构说明
- `.planning/WORKSTREAMS.md`
  - owner: planning
  - purpose: repo 级 workstream registry
  - not for: 单条线的完整状态
- `.planning/workstreams/<slug>/`
  - owner: planning
  - purpose: 单条 workstream 的目标、路线、状态
  - not for: 本地 session ledger
- Codex session
  - owner: local runtime
  - purpose: 执行现场、调试上下文
  - not for: repo truth
- commit / PR / evidence
  - owner: git / artifacts
  - purpose: 已完成工作的审计证据
  - not for: 未实现方案包装

## Task Routing

### 1. 新需求，需要新增功能

小范围功能可直接用 Codex 实现。跨模块、跨 contract、影响架构或需要多阶段验收时，
先创建 workstream：

```bash
gsd-sdk query workstream.create "<feature-name>" --raw --cwd "$PWD"
gsd-sdk query workstream.set <workstream-slug> --raw --cwd "$PWD"
```

然后补齐：

- `.planning/workstreams/<slug>/REQUIREMENTS.md`
- `.planning/workstreams/<slug>/ROADMAP.md`
- `.planning/workstreams/<slug>/STATE.md`

实现前先确认是否需要 ADR、architecture、contract 或 runbook 更新。

### 2. 开发途中需求发生变更

先更新 planning truth，再改实现：

- `REQUIREMENTS.md`：新增、删除或改写需求与 non-goals
- `ROADMAP.md`：phase 顺序或验收边界变化
- `STATE.md`：当前 stop point、blocker、下一步

不得让代码实现静默偏离已记录需求。

### 3. 修改已完成功能

先读原 workstream 的 reopen rule。

- 命中 reopen rule：恢复原 workstream，并更新 `STATE.md`
- 未命中但属于新产品范围：创建新 workstream
- 只是小修：直接 Codex 修复，但 final / commit 中说明对应原功能与验证

不要把 completed 状态改成含混的长期进行中。

### 4. 评估新架构，但没有进入实现

不改代码，不写成 current architecture truth。

- 只是候选想法：写入 `.planning/seeds/` 或当前 workstream 的 research / handoff
  文档
- 已形成长期决策：新增 ADR 或更新 `docs/architecture/`
- 被接受但尚未实现：ADR / architecture 必须明确 implementation status 和
  follow-up workstream

### 5. 架构约束更新，需要更新代码和实现

先冻结长期真相，再改代码：

1. 更新 `docs/architecture/` 或新增 ADR。
2. 更新受影响的 `docs/contracts/`、runbook 或 reference。
3. 创建或恢复 workstream。
4. Codex 分阶段修改代码、测试和部署证据。
5. closeout 时确认 docs、contracts、implementation、tests 一致。

### 6. 文档需要同步更新，或者存在漂移

先判断 source of truth：

- 代码是事实源：更新 docs。
- docs / contract 是事实源：修代码。
- 两边都不完整：先补 ADR / architecture / contract，再实现。

纯文档漂移可直接用 Codex 修复；涉及架构、runtime contract、authz、retrieval/data-plane
约束的漂移必须同步更新对应 tests 或 verification evidence。

## Execution Rules

- plain `codex` 可直接用于 workstream 内执行；不需要 repo 自建 wrapper。
- 不再写旧自建 harness 的 terminal JSON。
- 不再使用 repo-local Codex hooks 管理 stop / permission / terminal result。
- 不再维护 repo-local claim lease、heartbeat 或 handoff runtime ledger。
- 本地 session 状态不写回 tracked planning 文档。
- closeout 应更新对应 tracked planning truth，或在最终说明中明确本轮未触及 planning truth 的原因。
- Codex subagent 只在任务天然可并行、用户明确允许或 repo/root 指令要求时使用；GSD
  workstream 自身不自动创建 git worktree 或 subagent isolation。

## Closeout

完成一条线时，先确认：

1. 对应实现、文档和测试已经按任务范围收口。
2. `.planning/workstreams/<slug>/STATE.md` 反映真实 stop point。
3. `.planning/WORKSTREAMS.md` 的 active / completed / deferred / backlog
   状态与该线一致。
4. 实际运行过的验证命令已经记录在 commit、PR 或 closeout 文档中。

如果只是普通代码任务，不需要创建或切换 workstream；直接用 Codex 原生会话完成并按
repo 验证规则收口。

## Verification

修改本 runbook 或 workflow 入口后，至少运行：

```bash
pnpm docs:lint
git diff --check
gsd-sdk query workstream.status repo-wide-agent-harness-rollout --raw --cwd "$PWD"
```

如果同时修改 tracked planning 文件，再确认：

```bash
gsd-sdk query workstream.list --raw --cwd "$PWD"
gsd-sdk query workstream.progress --raw --cwd "$PWD"
```
