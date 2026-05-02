---
doc_type: roadmap
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Regulation RAG Release Lane Roadmap

## Phases

- [x] **Phase 0: Architecture And Design Contract** - 更新目标态架构文档，冻结
  reader publish lane 与 RAG release lane 分离、candidate lifecycle、增量更新与 operator
  status 语义。
- [x] **Phase 1: Candidate Contract And Store** - 设计并实现 `rag_release_candidate`
  schema、event log、selected batch input 与 app-api safe projection contract。
- [x] **Phase 2: Regulation Admission Handoff** - 让 `regulations/*`
  materialization 在 canonical document 变更后产生 candidate，不直接切 serving
  alias。
- [x] **Phase 3: Incremental Preparation Worker** - 实现 scheduled / selected
  candidate worker，支持 unchanged skip、changed upsert plan、withdrawn/deleted
  tombstone plan。
- [x] **Phase 4: Acceptance And Alias Publish** - 复用 retrieval release
  hardening 的 chunk quality、qrels coverage、drift guard、post-publish audit 与
  rollback/current pointer 规则。
- [x] **Phase 5: Operator Status Projection** - 在 app-api / panel 展示 document
  site 与 RAG preparation/index/serving/verification 分离状态，不泄漏 raw
  payload。
- [x] **Phase 6: Canary Cohort Closeout** - 用 current institutional rule、真实
  selected scoped non-current records、historical scoped rule 与 source-truth-only
  negative notice 验证端到端行为。
- [x] **Phase 7: Phase 13 Backfill Release Admission** - 将 Phase 13 historical
  regulation canonical backfill 的 10 个 targets 统一入队，修复 post-publish audit
  对 null release metadata 的误判，并完成真实 release lane 重放。

## Exit Criteria

- `institutional_rules` current regulation 更新能进入 RAG current alias。
- `scoped_rules` 仍保持 explicit/internal posture，除非 runtime profile 显式打开。
- historical / search-only scoped-rule 不进入 current RAG alias。
- 失败 release 不切 alias，operator 能看到 repair reason。
- docs lint、focused Python/TS tests 与 selected canary evidence 通过。
