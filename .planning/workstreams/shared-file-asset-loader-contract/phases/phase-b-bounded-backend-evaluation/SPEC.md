---
phase: "B"
name: "Bounded Backend Evaluation"
created: 2026-04-19
updated: 2026-04-19
status: active
---

# Phase B Spec

## Ambiguity Report

- Goal Clarity: `0.86`
- Boundary Clarity: `0.84`
- Constraint Clarity: `0.88`
- Acceptance Criteria: `0.85`
- Ambiguity: `0.14`

Phase A 已经把 owner、边界、asset families 与非默认路线冻结，因此 Phase B 不需要再做开放式方向讨论，只需要把剩余 implementation choices 限定在已冻结 posture 内完成 benchmark 与决策。

## In Scope

- 为 legacy binary Office 确认 conversion service baseline、operator contract 与 fail-close 条件
- 为 modern OOXML 确认 deterministic structured extraction 的首个实现路线
- 为 PDF / image family 确认 `MinerU` / `Paddle` / multimodal enrichment 的 routing threshold
- 冻结 Phase B benchmark rubric、sample matrix、decision artifact format 与 rejected alternatives
- 把 Phase B 结论准备成可直接供 Phase C/Phase D 消费的 backend decision truth

## Out Of Scope

- 不实现 shared substrate 或 source migration
  - 理由：这些属于 Phase C/Phase D
- 不重开 Phase A 已冻结的 canonical owner、asset family tranche、source-specific guardrails
  - 理由：Phase B 是 bounded evaluation，不是 scope reopen
- 不把 `openpyxl`、`xlrd`、`Docling`、`OpenDataLoader` 重新升格为默认 trunk 候选
  - 理由：这些路线已在 Phase A 和 supporting architecture 中完成降级或排除
- 不改写 `official_web` page-level source-truth 或 `authenticated_notice_portal` notice-level source-truth
  - 理由：shared file asset loader 只消费 file-like asset relation truth

## Requirements

1. Bounded candidate set must stay inside Phase A posture.
Current state:
  架构层已经冻结“哪类路线允许进入 trunk discussion”，但具体 benchmark 集合还没落盘。
Target state:
  Phase B 对每个 asset family 给出显式候选集与 rejected set，不允许回到开放式工具罗列。
Acceptance criteria:
  - [ ] legacy binary Office 只比较 self-hosted LibreOffice-family conversion service candidates。
  - [ ] modern OOXML 不再把 `openpyxl/xlrd` 视为 forward candidates。
  - [ ] PDF / image lane 不再把“单一 parser 统一全部资产”当成候选。

2. Sample matrix must represent real repo workload.
Current state:
  资产家族已经冻结，但 benchmark 输入矩阵还未正式定义。
Target state:
  benchmark 样本矩阵显式覆盖 `.doc`、`.xls`、`.docx`、`.xlsx`、born-digital PDF、scanned/layout-heavy PDF、document image、semantic image。
Acceptance criteria:
  - [ ] 每个 admitted family 都有明确样本类别与最小覆盖要求。
  - [ ] 样本来源与 provenance 记录方式被写清，不把一次性本地文件冒充长期 truth。

3. Evaluation rubric must align to shared contract, not parser marketing claims.
Current state:
  后续选型很容易被“支持格式列表”或模型宣传误导。
Target state:
  decision rubric 围绕结构保真、terminal outcome correctness、artifact provenance、operator cost 与 fail-close behavior。
Acceptance criteria:
  - [ ] rubric 至少覆盖 structure retention、table fidelity、layout/read-order correctness、terminal outcome correctness、provenance completeness、operator posture。
  - [ ] rubric 明确区分 parser quality 与 deployment mode 成本。

4. Phase B must end in decision artifacts consumable by implementation phases.
Current state:
  当前只有架构 posture，没有 implementation-ready decision package。
Target state:
 产出 single canonical decision package，并显式写出 family-by-family decision summary、rejected alternatives、routing threshold、operator assumptions，以及 deferred-to-Phase-C/Phase-D split。
Acceptance criteria:
  - [ ] Phase B 明确给出 modern OOXML、legacy binary Office、PDF、image 各自的 implementation entry choice。
  - [ ] Phase B 明确给出哪些问题留给 Phase C/Phase D，哪些问题在 Phase B 已关闭。
  - [ ] Phase B 有单一 canonical closeout artifact，而不是依赖 wildcard quick notes 或散落段落。
