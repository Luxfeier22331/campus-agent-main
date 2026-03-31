---
doc_type: reference
status: active
created: 2026-03-31
updated: 2026-03-31
---

# Eval Gold Truth Model

## 目的

本文固定 `packages/evals` 中 golden case 的长期 truth 分层，避免继续把 deterministic gate、RAGAS reference 和 retrieval/context truth 混写成一份过薄 case。

## 四层 Truth

### 1. Deterministic Truth

- `expected_sources`
- `forbidden_sources`
- `required_facts`
- `forbidden_claims`
- `trace_expectation`

用途：

- deterministic `status / retrieval / answer / trace` gate
- canonical release gate denominator

约束：

- `required_facts` 只表达 deterministic 最小通过条件
- 不要为了改善 supplemental score 往 `required_facts` 中塞大量 answer claims

### 2. Answer Reference Truth

- `reference_facts`

用途：

- text-based supplemental reference
- 当某个 metric 仍需要 free-text reference 时，作为 `reference` 主来源

约束：

- 每条尽量是单一、原子化 claim
- 优先写 answer-bearing facts，不写纯主题词
- 不写文号、标题、章节名，除非它们本身就是问题要点

### 3. Context Reference Truth

- `reference_context_ids`
- `reference_contexts`

用途：

- retrieval/context soft metric 的 canonical truth
- 当前优先 `reference_context_ids`，`reference_contexts` 只作 text fallback

当前实现说明：

- repo-head 当前用稳定 source ID 作为 context ID
- 当 corpus 具备稳定 chunk truth 时，可继续收紧到 chunk-level ID

### 4. Metric Applicability Truth

- `supplemental_metric_overrides`

用途：

- 显式说明某个 case 是否应进入某个 supplemental metric denominator

当前固定规则：

- title lookup / article lookup / topic lookup 可以继续参与 retrieval 与 deterministic gate
- 但不应默认进入 `ragas.answer_relevancy`
- 是否排除由 case 显式配置，不靠 runtime 猜测

## 当前字段语义

`GoldenCase.required_facts`

- deterministic completeness only

`GoldenCase.reference_facts`

- supplemental text reference only

`GoldenCase.reference_context_ids`

- preferred context truth for `context_precision / context_recall`

`GoldenCase.reference_contexts`

- fallback context truth when stable IDs are not available

`GoldenCase.supplemental_metric_overrides`

- metric-name -> bool
- `False` 表示该 case 不进入该 supplemental metric denominator

## RAGAS Projection 规则

当前 `build_ragas_projection()` 固定为：

- `retrieved_contexts`
  优先使用 statement-level supporting contexts
- `retrieved_context_ids`
  与 supporting contexts 同步的 stable source ID
- `reference`
  优先 `reference_facts`，再回退 `required_facts`
- `reference_context_ids`
  直接来自 case
- `reference_contexts`
  直接来自 case

context metric 路由：

- 存在 `reference_context_ids` + `retrieved_context_ids` 时，优先 ID-based context metrics
- 否则回退 text-based context metrics

## Case Authoring Checklist

对 `expected_status="completed"` 的 case：

- 必须有 deterministic truth
- 若要进入 context metric，必须提供 `reference_context_ids` 或 `reference_contexts`
- 若是 title/article/topic lookup，应显式关闭 `answer_relevancy`
- 若保留 `answer_relevancy`，`user_goal` 应是自然问题句，而不是纯标题或纯条款号

## 当前 Handbook / Curriculum 约束

- `student_handbook` 与 `curriculum_plan` 的 completed release/regression cases 现在都应显式携带 context truth
- handbook `宿舍照明`、奖学金/公费医疗标题类 case 已按 lookup case 处理，不再默认进入 `answer_relevancy`
- curriculum 纯标题/方案名 exact-match case 同样按 lookup case 处理
