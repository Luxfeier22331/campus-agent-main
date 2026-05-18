---
doc_type: roadmap
status: completed
created: 2026-05-02
updated: 2026-05-03
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
- [x] **Phase 8: Release Admission Hardening** - 为 query-enabled regulation release
  增加 scope-level admission manifest、candidate admission proof、alias containment
  与 forced policy replay，完成 suspect institutional release containment/replay。
- [x] **Phase 9: Institutional 30 Release** - 只针对校级 `institutional_rules`
  当前 scope 扩展到 30 条制度，完成 reader/chunk/admission/candidate/release/alias
  全链路发布；院级 `scoped_rules` 不进入默认 query-serving。
- [x] **Phase 10: Institutional RAG Consumption Acceptance** - 为 30 条校级
  `institutional_rules` 补齐 33 条 qrels、live retrieval、answer source-identity
  contract 与 evidence handoff，确认可进入下游 RAG 消费。
- [x] **Phase 11: Selected School-Level Regulation Admission** - 从 scoped holding
  set 中显式重纳入 12 条校级 regulation 到 `institutional_rules` 默认 consumption
  truth，保持 `scoped_rules` 不全局 query-serving，并将 release qrels、release
  acceptance、golden qrels 与 answer-quality fixture 扩展到 42 条校级制度。
- [x] **Phase 12: Institutional 42 Quality And Release** - 对 42 条校级
  `institutional_rules` 做统一清洗/chunk 质量收口；12 条重纳入规则已按
  `institutional_rules_formal_v1` 生成 institutional-scope chunk evidence，质量门通过。
  12 条已写入对象存储与 operator registry，42-doc registry-scope preparation、
  release admission、candidate enqueue、embedding/index/alias publish 已完成；
  42 个 release candidates 全部为 `serving_published`，alias
  `institutional_rules` 指向 1747 points 的 Phase 12 collection。release-gate
  live retrieval 45 cases 通过。
- [x] **Phase 13: Institutional Golden Retrieval Quality Follow-Up** - 修复
  golden retrieval 89 cases 中暴露的 3 个检索策略缺口：`三助` 管理办法正例通过
  `助教/助研/助管 -> 三助` title alias 召回，年度/届次实施办法 scope-membership
  问法与院级 scoped-rule decoy 问法通过 institutional no-hit/scope guard fail-close。
  release-gate live retrieval 45 cases 与 golden retrieval 89 cases 均达到
  `doc_hit@1=1.0`、`doc_recall@5=1.0`、`forbidden_hit_rate=0.0`。
- [x] **Phase 14: Institutional Answer And Product-Path Acceptance** - 完成
  42 条校级 `institutional_rules` answer-quality contract，42/42 通过；新增并验证
  `rag_delegate_institutional_rules` supervisor product-path smoke，使用
  `campus_members` / `restricted` / `campus` 授权投影，确认真实产品路径能返回
  `grounded_answer` 且不落入 `no_answer`。
- [x] **Phase 15: Institutional Release Baseline Gate** - 新增
  `institutional-rules-release-baseline` eval gate，将 release retrieval 45 cases、
  golden retrieval 89 cases、answer-quality 42 cases、Qdrant no-hit suite 与
  `rag_delegate_institutional_rules` product-path smoke 固化为一条 release 前手动
  baseline；真实 gate 运行 5/5 checks 通过。

## Exit Criteria

- `institutional_rules` current regulation 更新能进入 RAG current alias。
- `scoped_rules` 仍保持 explicit/internal posture，除非 runtime profile 显式打开。
- selected school-level re-admission 不得把年度/届次实施办法带入默认 consumption。
- historical / search-only scoped-rule 不进入 current RAG alias。
- 失败 release 不切 alias，operator 能看到 repair reason。
- focused Python tests、JSON evidence、candidate store 与 alias 状态验证通过。
- release-gate live retrieval 继续保持 42 条校级制度全覆盖。
- golden retrieval follow-up 不得通过打开 `scoped_rules` 或年度/届次实施办法进入默认
  consumption 来规避 no-hit/scope guard 问题。
- answer-quality 与 supervisor product-path smoke 不得使用 public 授权投影访问
  restricted campus institutional payload。
- institutional release baseline 必须保持为 release/manual gate；在没有 Qdrant /
  embedding env / supervisor local runtime 的通用 CI 中不得伪装成已验证。
