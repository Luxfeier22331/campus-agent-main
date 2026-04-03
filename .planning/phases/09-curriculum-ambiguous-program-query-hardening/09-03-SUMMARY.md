# 09-03 Summary

## Outcome

- curriculum deictic / verified-identity / soft-personalization ladder 现在已经形成 repo-tracked closeout，不再只是散落在 planner 逻辑与单测里的隐式行为。
- `RagResultDiagnostics` 现在会显式暴露 `candidate_title_summary`、`used_verified_identity`、`used_soft_preference`，便于区分硬解析、soft bias 与澄清候选。
- `实验班` 这类 forbidden generic alias 现在在 deictic curriculum lane 里也保持 clarification-first，不会因为 `我这个专业的...` 短句就静默进入检索。
- retrieval qrels preflight 现在会 fast-fail soft-personalization-only 的 family-alias single-doc truth。
- Phase 9 的 curriculum ambiguity hardening 已从 alias inventory 收口到 deictic / soft-bias / eval governance 的完整闭环。

## Main Changes

- `packages/contracts/src/campus_contracts/models.py`
  - `RagResultDiagnostics` 新增 candidate summary 与 identity / soft-bias 诊断字段。
- `packages/rag-specialist/src/campus_rag_specialist/curriculum_query_planning.py`
  - `CurriculumQueryPlan` 现在显式记录 `used_verified_identity`、`used_soft_preference` 与 candidate summary。
  - `基地班` clarification 会把 verified-major 对应候选提到前面，但仍保持 fail-closed clarification。
  - `实验班` / `创新班` 的 generic alias 现在在 deictic curriculum lane 里也会直接澄清。
  - `民族实验班` 这类更具体 alias 不会被 generic `实验班` 误伤。
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - curriculum diagnostics 现在显式输出 `resolved_single` / `needs_clarification` 与 identity-vs-soft-bias 参与情况。
- `packages/evals/src/campus_evals/benchmark.py`
  - qrels preflight 现在会拦截 `recent_goal` / `confirmed_slot_terms` / profile-memory-only 的 family alias single-doc truth。
- `packages/evals/src/campus_evals/scenarios.py`
  - regression 新增 `我这个专业的实验班大二下有什么课` clarification case。
- `packages/evals/README.md`
  - 记录 verified-identity deictic truth 与 soft-personalization-only fast-fail 约束。
- `tests/specialist/test_rag_specialist.py`
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_retrieval_benchmark.py`
  - 新增 09-03 closeout 回归测试。

## Added Gate Coverage

- deictic + verified major:
  - `我这个专业的基地班大二下有什么课`
- verified major 只能 soft bias，不得静默 resolve:
  - `基地班`
- deictic + forbidden generic alias:
  - `我这个专业的实验班大二下有什么课`
- qrels preflight:
  - `soft personalization alone` 不得 author 成 curriculum canonical single-doc truth

## Deferred

- 中央民族大学长尾 alias 与 pattern alias 仍未全量建库。
- `创新实验班` / `名称里带“实验班/创新班”` 的 name-pattern completed lane 已在后续 follow-up 中建立。
- `family -> single program -> semester` 的 follow-up 承接现已从纯 `recent_goal` 过渡到显式 session slot contract：
  - `curriculum_program_family`
  - `curriculum_program`
  - `curriculum_semester`
  - specialist 现优先消费这些 confirmed slot；缺失时才回退到 `recent_goal`
  - `SessionSummary.curriculum_follow_up` / `resolve_curriculum_follow_up_slots(...)` 已作为 repo 级单一读取真相
- 上游 app-layer/session-layer 的最小写入闭环现也已落地：
  - `apps/app-api` 新增 `chat.session_slots` conversation-scoped session truth
  - `runtime-command` 会在 finalized curriculum completion 时，根据 typed diagnostics 同事务替换写入当前 slot 快照，而不是追加历史 slot
  - `packages/rag-specialist` 的 curriculum single-program completed diagnostics 现在会显式产出：
    - `session_program_family`
    - `session_program`
    - `session_semester`
  - 后续同一 conversation 的 supervisor 请求会把这些 confirmed slot 回灌进 `context.session.confirmed_slots`
  - `needs_clarification` / 无 typed follow-up truth 的请求不会写 slot
- app-api live eval 现在也能在单个 benchmark case 内重放多轮 conversation：
  - 首轮 completed curriculum answer 写入 conversation-scoped session truth
  - 第二轮 follow-up 通过同一 `conversationId` 复用 slot 回灌
  - release gate 已新增 `curriculum-release-gate-program-follow-up-session-replay`
- 但更长期的产品策略仍待补齐：例如除 curriculum 之外的 session slot family、slot 生命周期治理、以及未来是否需要 panel/operator 可见的 slot diagnostics 仍未单独展开。
- curriculum live acceptance artifact 是否需要在这轮 closeout 后重跑，仍取决于后续是否要把当前 automated evidence 再提升成新的 release artifact。
