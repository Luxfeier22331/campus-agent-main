---
doc_type: plan
status: active
created: 2026-03-22
updated: 2026-03-22
---

# Golden Dataset 文档交付实施文档

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `campus-agent` 建立独立的 golden dataset 治理文档，并完成长期架构、决策文档与 docs 索引之间的职责拆分和引用闭环。

**Architecture:** 本次交付只处理文档分层，不落地 `student_handbook` 首批样本、runner 或 scorer 配置。长期边界继续保留在 `architecture`，golden dataset 的长期规则迁入独立 ADR，本轮交付步骤与 deferred items 进入独立 plan。

**Tech Stack:** Markdown, repo docs conventions, ADR metadata, architecture/decision/plan 文档分层

---

## 摘要

本实施文档只回答三件事：

- golden dataset 的治理规则应该落在哪类文档
- 长期架构文档应保留哪些 eval 边界，不应再承载哪些具体规则
- 本轮文档交付需要新增哪些 canonical docs 和索引

本轮明确不做：

- 不冻结 phase-1 首批题目、样本规模或 split 配额
- 不定义 runner 命令、文件格式或 scorer 接线
- 不把 `ragas`、OpenAI graders 或其他实现方案写成长期承诺

## 文档分层

- `docs/architecture/long-term-architecture.md`
  保留 `packages/evals` 的边界、职责与可替换性原则
- `docs/decisions/adr-0003-golden-dataset-governance.md`
  冻结 golden dataset 的长期治理规则
- `docs/plans/golden-dataset-document-delivery.md`
  记录本轮文档交付步骤、验收点和 deferred items

## 实施任务

### Task 1: 新增 Golden Dataset 治理 ADR

**Files:**
- Create: `docs/decisions/adr-0003-golden-dataset-governance.md`

**Implementation:**
- 冻结 golden dataset 的角色、分层真值模型、最小 case schema、split 语义、provenance 治理与 scorer 可替换边界
- 明确 ADR 的非目标，避免把 phase-1 样本、CI 阈值或 scorer 选型写成长期规则

### Task 2: 新增文档交付 Plan

**Files:**
- Create: `docs/plans/golden-dataset-document-delivery.md`

**Implementation:**
- 说明 architecture / decision / plan 三类文档在 golden dataset 主题上的分工
- 记录本轮交付物、验收标准和 deferred items

### Task 3: 收紧长期架构文档

**Files:**
- Modify: `docs/architecture/long-term-architecture.md`

**Implementation:**
- 保留 `evals` 是独立质量控制边界
- 删除或收紧具体到 golden dataset 治理层的描述
- 增加对 `adr-0003-golden-dataset-governance.md` 的引用

### Task 4: 更新 Docs 索引

**Files:**
- Modify: `docs/README.md`

**Implementation:**
- 将新增 ADR 与 Plan 加入 canonical docs 列表
- 保持现有稳定 slug 与 front matter 约定不变

## 验收标准

完成后以下条件同时成立：

- 长期架构文档不再承担 golden dataset 的具体治理职责
- golden dataset 的长期规则有独立 ADR 承载
- docs 索引可以明确找到新的 ADR 与 Plan
- 文档之间不存在职责冲突：architecture 讲边界，ADR 讲规则，plan 讲交付

## Deferred

以下内容明确延后到后续文档或实现：

- `student_handbook` phase-1 首批 golden cases
- case 文件的具体存储格式
- runner / expectations / grader 的实现方案
- CI gate 阈值与发布门禁数值
- synthetic 生成策略与人工标注流程细节
