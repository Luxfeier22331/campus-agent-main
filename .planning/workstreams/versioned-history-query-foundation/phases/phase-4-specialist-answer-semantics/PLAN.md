---
doc_type: phase_plan
phase: "4"
phase_name: "Specialist Answer Semantics"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 4 Plan

## Objective

冻结 `rag-agent` 的 version-aware answer semantics：
让 `current / historical / as_of / compare` 成为 code-owned、可验证、可回归的回答模式，而不是 retrieval 完成后继续走同一个 generic answer path。

## Why This Phase Exists

当前 repo 已经有：

- 显式 `version_query` protocol
- registry-backed version resolution
- retrieval pre-filter
- 历史 unresolved fail-close

但还没有：

- historical/as_of 回答的显式 non-current disclosure
- compare 的双侧 evidence partition
- version-aware diagnostics / semantic outcome
- 一套能稳定验证“回答到底针对哪个版本”的 answer contract

如果不做这一步，系统会停在一个危险中间态：

- retrieval 已经查对版本
- 但 final answer 仍可能像 current answer 一样输出
- compare 仍可能把两侧 evidence 混成普通摘要
- 后续 eval 无法判断回答语义是否真正尊重版本模式

## Locked Inputs

- 当前 workstream 只覆盖 `current / historical / as_of / compare`
- `Phase 3` 已经把 version selection truth 接到 retrieval
- 当前 phase 不扩 live/freshness
- 当前 phase 不扩跨文档 compare
- 当前 phase 优先修正 answer semantics，而不是重构 retrieval planner

## Decisions To Freeze

1. `current` 继续沿用现有 grounded answer 语义，不为历史能力回退当前行为。
2. `historical` 回答必须显式提示“这是历史版本/非现行版本”。
3. `as_of` 回答必须显式提示“这是截至某时间点的版本语义”，并暴露 time anchor truth。
4. `compare` 回答必须显式区分：
   - 旧版
   - 新版
   - 变化点
5. `compare` 若拿不到双侧 answer-bearing evidence，不允许输出“变化点总结”。
6. version-aware semantics 需要 diagnostics 合同同步更新；只改 answer_text 不算完成。
7. prompt synthesis 只能消费已经冻结好的 version-aware context；不能反过来决定 version semantics。

## Execution Slices

### Slice 1: Introduce Version-Aware Runtime Answer Context

- 在 `rag-agent` 中新增最小 version-aware runtime context，承载：
  - request `version_query.mode`
  - resolved primary selection
  - resolved comparison selection
  - query temporal anchor（例如 `as_of`）
- 这层 context 是 answer owner，不是 retrieval owner。

### Slice 2: Freeze Diagnostics Contract

- 评估是否为 `RagResultDiagnostics` 增加最小 version-aware 字段，例如：
  - `version_query_mode`
  - `primary_version_id`
  - `comparison_version_id`
  - `answer_temporal_posture`
  - `as_of_anchor`
- 若能复用现有字段表达，则保持最小；若不能稳定支持 Phase 5 eval，则正式扩 contract。

### Slice 3: Deterministic Historical / As-Of Answer Framing

- 为 `historical` / `as_of` 增加 deterministic framing：
  - 先说明 temporal posture
  - 再回答 grounded content
  - 明确它不是普通 current answer
- fail-close 规则：
  - 历史答案若 evidence 中混入 current-only truth 且无法明确分离，应降级或 no-answer

### Slice 4: Compare Evidence Partition And Answer Framing

- 基于 `version_id` 对 supporting evidence 做 primary/comparison partition
- 确定 compare 最小答案结构：
  - 旧版结论
  - 新版结论
  - 可证据支持的变化点
- 若 only-one-side support：
  - 不输出变化点
  - 返回明确 no-answer / insufficient_grounding 风格结果

### Slice 5: Tests First

- `historical`：
  - answer_text 明确披露“历史/非现行”
  - diagnostics 记录正确版本 posture
- `as_of`：
  - answer_text 明确披露时间点
  - diagnostics 记录 `as_of` anchor
- `compare`：
  - 双侧 evidence 都存在时，回答明确区分旧版 / 新版 / 变化点
  - 缺单侧 evidence 时 fail-close
- `current`：
  - 保证现有 current answer 语义不回归

### Slice 6: Verification Loop

- 跑 `tests/specialist/test_rag_specialist.py`
- 若改了 contracts，同步跑：
  - `tests/contracts/test_models.py`
  - `tests/api/test_supervisor_api.py`
- 如 diagnostics shape 影响 supervisor observability，再补：
  - `tests/supervisor/test_supervisor_core.py`

## Proposed Write Set

- `packages/rag-agent/src/campus_rag_agent/service.py`
- 如需更强 deterministic framing：
  - `packages/rag-agent/src/campus_rag_agent/agent.py`
  - `packages/rag-agent/src/campus_rag_agent/prompt_packets.py`
- 若 diagnostics 合同需补字段：
  - `packages/contracts/src/campus_contracts/models.py`
  - `packages/contracts/src/campus_contracts/__init__.py`
- tests:
  - `tests/specialist/test_rag_specialist.py`
  - 视 contract 变更补：
    - `tests/contracts/test_models.py`
    - `tests/api/test_supervisor_api.py`
    - `tests/supervisor/test_supervisor_core.py`

## Verification Matrix

- behavior verification
  - `current` 保持当前 grounded answer
  - `historical` 明确 non-current disclosure
  - `as_of` 明确 time-anchor disclosure
  - `compare` 明确双侧版本和变化点语义
- boundary verification
  - 不重做 retrieval filter plumbing
  - 不把 version semantics 塞回 prompt-only logic
- fail-close verification
  - compare 缺单侧 support 时不输出变化点
  - unresolved / insufficient support 不静默降级为 current answer
- observability verification
  - diagnostics 能区分 version-aware answer posture
  - Phase 5 可据此编写 eval

## Exit Rule

Phase 4 完成后，repo 应达到：

- version-aware retrieval 与 version-aware answer semantics 已正式对齐
- 用户看到的 `historical / as_of / compare` 回答不再冒充普通 current answer
- compare 已成为可验证的双侧语义，而不是 generic summary
- `Phase 5` 可以直接围绕 current/historical/as_of/compare 编写最小 eval 集
