---
doc_type: plan
status: active
created: 2026-03-25
updated: 2026-03-25
---

# Agent Orchestration 架构刷新实施文档

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 刷新 `campus-agent` 的编排相关 canonical docs，使长期架构与当前官方 agent 建议保持一致，同时不改变已冻结的 package boundary、phase-1 主链路和 data-plane truth。

**Architecture:** 本次交付只做文档层刷新。长期架构继续保持 `supervisor-led orchestration + specialist boundary + independent ingestion/data plane + replaceable retrieval backend`。本轮新增 `hybrid orchestration`、specialist admission rule、`untrusted data boundary`、approval / HITL gate 和 trace / eval gate 等长期规则，并把 `AgentOS-native`、`LlamaIndex + Qdrant`、`MinIO` 明确回收到 phase-1 实现决策。

**Tech Stack:** Markdown, repo docs conventions, ADR metadata, architecture / decision / plan 文档分层

---

## 摘要

本轮交付只回答四件事：

- 长期编排模式应如何表述，才能既保持 `supervisor-led`，又不误写成“只允许 handoff”
- 哪些长期规则应进入独立 ADR，而不是继续散落在 architecture 或 phase-1 ADR 中
- phase-1 运行时与 retrieval 选型如何继续保留，但不被误读成长期绑定
- docs 索引、README 与 supervisor 当前实施文档如何同步收口

本轮明确不做：

- 不新增 specialist
- 不修改 `packages/contracts`
- 不切换 runtime、retrieval backend 或对象存储实现
- 不新增 approval / HITL 代码实现
- 不新增 eval 阈值、CI gate 数值或 scorer 配置

## 文档分层

- `docs/architecture/long-term-architecture.md`
  保留长期边界、链路形态、角色职责与跨边界不变量
- `docs/architecture/supervisor-architecture.md`
  保留 supervisor 的长期工作方式与当期最小正确形态
- `docs/decisions/adr-0001-phase1-architecture.md`
  保留 phase-1 当前 runtime / backend 取舍
- `docs/decisions/adr-0004-evaluation-metrics.md`
  保留 workflow / safety / gate 指标语义
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
  冻结长期编排模式、specialist 准入与安全边界
- 本文
  记录本轮文档刷新任务、文件落点和验收标准

## 实施任务

### Task 1: 新增长期编排与安全 ADR

**Files:**
- Create: `docs/decisions/adr-0006-agent-orchestration-and-safety.md`

**Implementation:**
- 冻结 `hybrid orchestration`
- 冻结 `manager-managed specialist` 与 `explicit handoff` 的并存边界
- 定义新增 specialist 的准入规则
- 定义 `untrusted data boundary`
- 定义 approval / HITL 与 trace / eval gate 的长期位置

### Task 2: 收紧长期架构文档

**Files:**
- Modify: `docs/architecture/long-term-architecture.md`

**Implementation:**
- 将“反对 flat tool”收紧为“反对把 RAG 降级成顶层产品路径里的扁平 tool adapter”
- 补入 `hybrid orchestration`、specialist admission rule 与 `untrusted data boundary`
- 明确 `AgentOS-native` 只是 phase-1 当前实现选择，不是长期 runtime freeze
- 补入对 `adr-0006-agent-orchestration-and-safety.md` 的引用

### Task 3: 刷新 Supervisor 架构文档

**Files:**
- Modify: `docs/architecture/supervisor-architecture.md`

**Implementation:**
- 将 supervisor 与 specialist 的交互从“只允许 handoff”改成“允许 delegation / handoff 两类稳定交互”
- 明确 top-level path 默认由 supervisor 保持控场
- 明确 phase-1 当前仍采用 `single-specialist, policy-driven coordinator`
- 补入对 future specialist admission rule 与 trace / eval gate 的引用

### Task 4: 更新 phase-1 ADR 与评测指标 ADR

**Files:**
- Modify: `docs/decisions/adr-0001-phase1-architecture.md`
- Modify: `docs/decisions/adr-0004-evaluation-metrics.md`
- Modify: `docs/plans/supervisor-current-design-implementation.md`

**Implementation:**
- 让 `adr-0001-phase1-architecture.md` 明确自己只回答 phase-1 当前实现取舍
- 让 `adr-0004-evaluation-metrics.md` 明确 routing、delegation / handoff、approval path 与 trace observability 也是正式门禁对象
- 让 `supervisor-current-design-implementation.md` 明确当前默认由 supervisor 持续控场，不开放用户可见 handoff

### Task 5: 更新 Docs 索引与 Repo 入口

**Files:**
- Modify: `docs/README.md`
- Modify: `README.md`

**Implementation:**
- 将新增 ADR 与 plan 加入 canonical docs
- 在 repo 入口文档中补齐 supervisor 架构和编排 / 安全 ADR 的引用
- 统一“长期 runtime 未冻结”和“phase-1 当前已选型”的表述

## 验收标准

完成后以下条件必须同时成立：

- 长期架构文档明确写出 `hybrid orchestration`
- 长期架构文档明确写出 specialist admission rule
- 长期架构文档明确写出 `untrusted data boundary`
- `docs/architecture/supervisor-architecture.md` 不再把 handoff 写成唯一合法交互模式
- `docs/decisions/adr-0001-phase1-architecture.md` 不再容易被误读为长期 runtime freeze
- `docs/decisions/adr-0004-evaluation-metrics.md` 明确 workflow / trace / safety gate 对编排变化的正式门禁地位
- `docs/README.md` 与 `README.md` 能正确索引并解释这轮新增文档

## Deferred

以下内容明确延后到后续实现或后续 phase：

- 新 specialist 的实际引入
- approval / HITL 的运行时实现
- user-visible handoff 的产品化设计
- runtime、retrieval backend 或 storage backend 的替换
- 新 gate 的阈值、报表与 CI wiring
