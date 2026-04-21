---
phase: "4"
name: "Specialist Answer Semantics"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 4 Context

**Gathered:** 2026-04-21
**Status:** Completed

<domain>
## Phase Boundary

本 phase 只负责：

- 为 `rag-agent` 冻结 `current / historical / as_of / compare` 的用户可见回答语义
- 明确 non-current 回答必须显式标注“不是现行版本”
- 为 compare 冻结双侧 evidence partition 与 fail-close 规则
- 让 version-aware answer semantics 成为 code-owned、可验证的 runtime truth

它不负责：

- 扩写新的 retrieval planner / live branch
- 重做 `Phase 3` 的 version filter plumbing
- 完整 eval harness
- UI 展示设计

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已有显式 `VersionQuery(mode=current|historical|as_of|compare)`
- `Phase 2` 已有 registry-backed `ResolvedVersionQuery`
- `Phase 3` 已有 retrieval pre-filter：
  - `target_version_ids`
  - `target_revision_track`
  - unresolved historical request 会 `fail-close`
- 当前 `rag-agent` 仍只有 generic answer semantics：
  - `grounded_answer`
  - `unsupported_by_evidence`
  - `freshness_fail_close`
  - `restricted_access_denied`
- 当前还没有：
  - historical answer 必须显式提示“非现行”
  - as_of answer 必须显式绑定时间锚点
  - compare answer 必须显式区分旧版 / 新版 / 变化点
  - version-aware diagnostics / evidence partition

</current_truth>

<decisions>
## Working Decisions

- **04-01:** `Phase 4` 的 owner 是 `rag-agent` answer semantics，不是 prompt-only polish。
- **04-02:** current answer semantics 保持当前 grounded answer 路径，不为历史能力回退现有 current behavior。
- **04-03:** historical / as_of 回答必须显式披露 temporal posture；不能只返回条文正文而不说明“该内容不是现行规定”或“这是某一时间点的版本”。
- **04-04:** compare 回答必须把双侧版本 truth 显式区分，不能把两个版本的 chunk 混成单边摘要。
- **04-05:** compare 若无法稳定拿到双侧 answer-bearing evidence，则必须 fail-close 或降级为明确说明，而不是继续输出“变化点”推断。
- **04-06:** version-aware semantics 需要 diagnostics / evidence 侧同步落盘，否则后续 eval 无法判断模型到底回答了哪个版本。
- **04-07:** 当前 phase 优先 deterministic answer framing；只有在 version partition 已清晰且 citation/grounding 规则明确时，才允许 prompt synthesis 参与 final wording。
- **04-08:** 不把 `compare` 扩写成跨文档差异比较；仍限定在 `Phase 2/3` 已收敛的 logical document 版本轴上。

</decisions>

<specific_gaps>
## Specific Gaps

- `rag-agent` 目前没有保存 resolved version selection truth 给 answer layer 消费。
- `RagResultDiagnostics` 目前没有 version-aware fields，无法显式记录：
  - query mode
  - primary/comparison version ids
  - temporal anchor
  - answer posture 是否为 historical/as_of/compare
- supporting evidence 当前没有 primary/comparison partition；compare 模式下容易把两侧 source 混成一个 generic supporting bundle。
- 当前测试只覆盖了 “历史版本过滤被传给 retriever” 与 “unresolved fail-close”，没有覆盖最终回答语义。

</specific_gaps>

<canonical_refs>
## Canonical References

- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-3-retrieval-version-filter/SUMMARY.md`
- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/rag-agent/src/campus_rag_agent/service.py`
- `tests/specialist/test_rag_specialist.py`

### Web Sanity-Check References

- `https://developers.openai.com/api/docs/guides/agent-builder-safety`
- `https://developers.openai.com/api/docs/guides/citation-formatting`
- `https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/evaluation-evaluators/rag-evaluators`
- `https://learn.microsoft.com/en-us/agent-framework/agents/rag`

</canonical_refs>
