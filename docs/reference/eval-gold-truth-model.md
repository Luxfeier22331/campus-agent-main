---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-03-31
updated: 2026-06-12
---
# Eval Gold Truth Model

## 目的

本文固定 `packages/evals` 中 golden case 的长期 truth 分层，避免继续把 deterministic gate、RAGAS
reference 和 retrieval/context truth 混写成一份过薄 case。

## Candidate Admission Lifecycle

production request、incident、operator badcase 或低置信 audit 只能先进入 eval-owned
candidate review manifest，不能直接写入 golden truth。

固定链路：

1. `app-api` 或 audit exporter 只提供 request / trace / sampled_at 等 correlation，以及可复现的候选
   input。
2. `packages/evals` 用 admission CLI 生成 `pending_review` manifest。
3. eval reviewer 完成 dedupe、边界判断和 expected truth 修订后，用
   `campus_evals.observed_regression_review apply` 生成 reviewed manifest 与 accepted
   fixture。
4. 接收入 fixture 后，deterministic gate 才把它计入 release / regression denominator。
5. supplemental grader、OpenAI tracing、Sentry、Axiom 或 Operator Console 只能消费
   artifact 或 backlink，不改写 canonical truth。

当前 intent badcase 的 repo-owned 入口：

- candidate manifest builder：
  `uv run --all-packages python -m campus_evals.eval_admission intent-candidates`
  with `--input <mined.jsonl> --output <review-manifest.json>`
- accepted observed regression fixture：
  `packages/evals/fixtures/ops/intent_observed_regression.json`
- review apply workflow：
  `uv run --all-packages python -m campus_evals.observed_regression_review apply`
  with `--manifest <pending.json> --decisions <decisions.json> --reviewed-output
  <reviewed.json> --accepted-output <accepted.json>`
- default gate：
  `uv run --all-packages python -m scripts.intent_gate`

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
- 当前优先 `reference_context_ids`，`reference_contexts` 只作显式文本参考

当前实现说明：

- repo-head 当前用稳定 source ID 作为 context ID
- 当 corpus 具备稳定 chunk truth 时，可继续收紧到 chunk-level ID

### 4. Metric Applicability Truth

- `supplemental_metric_overrides`

用途：

- 显式说明某个 case 是否应进入某个 supplemental metric denominator

当前固定规则：

- title lookup / article lookup / topic lookup 可以继续参与 retrieval 与 deterministic
  gate
- 但不应默认进入 `ragas.answer_relevancy`
- 是否排除由 case 显式配置，不靠 runtime 猜测

## Structured / Product / Privacy Denominator Truth

`Phase 8-13` 新增的 eval family 不 author domain truth，也不替代 runtime owner。它们只固定
denominator expectation、sanitized observation shape 与 deterministic verdict：

- `online_answer_path`
  - truth 来源是产品路径 case expectation：request / trace correlation、selected capability、
    terminal outcome、response contract 与 operator backflow summary
  - 不保存 raw transcript、raw prompt 或 provider raw response
- `tool_family_denominators`
  - truth 来源是 opened tool denominator：tool name、split、expected result status 与必要
    argument summary
  - failure class 只表达 routing error、read-model gap、capability-not-open /
    source-truth fail-close 或 missing observation，不替代 service / notice read-model
    owner
- `document_quality_cases`
  - truth 来源是 OCR/MinerU/document-quality expectation：required spans、table headers、
    confidence、allowed projection target 与 forbidden claims
  - visual/OCR output 不得被 author 成 regulation-ready owner text
- `privacy_boundary_cases`
  - truth 来源是 account / session / memory boundary expectation：terminal outcome、
    fail-close reason、sanitized caller summary 与 memory influence summary
  - eval artifact 不得携带 JWT、cookies、auth envelope、raw auth material、raw memory
    payload、raw transcript、raw prompt 或 provider raw response
- `agentic_retrieval_plan_cases`
  - truth 来源是 retrieval planning expectation：decomposition、step plan、freshness branch、
    live branch outcome、supporting evidence ids 与 final answer status
  - plan、freshness、evidence、live fail-close 与 final answer failure 必须分开归因
- `eval_operations_profile_policy`
  - truth 来源是 eval-owned operations policy：budget、timeout、retry、pacing、breaker、
    retention、gate mode、failure disposition、quarantine readmission 与 version summary
  - operations policy 只治理 eval runtime，不 author domain case truth

## 当前字段语义

`GoldenCase.required_facts`

- deterministic completeness only

`GoldenCase.reference_facts`

- supplemental text reference only

`GoldenCase.reference_context_ids`

- preferred context truth for `context_precision / context_recall`

`GoldenCase.reference_contexts`

- explicit text context truth when stable IDs are not available

`GoldenCase.supplemental_metric_overrides`

- metric-name -> bool
- `False` 表示该 case 不进入该 supplemental metric denominator

## 歧义 Truth 治理

当 query 的自然语义仍对应多个当前有效候选时：

- 不要把它继续写成 canonical retrieval qrels 的单目标 `expected_sources`
- authoring / review 阶段可以先以 `warn` 暴露问题
- canonical benchmark / CI / release gate 必须把未裁决歧义升级为 `error` 并 fast-fail
- 正确归宿通常是：
  - `needs_clarification` workflow case
  - 或 diagnostic / annotation fixture

判断标准：

- 当前 active title / source truth 下是否存在多个可成立候选
- query 是否缺少足够限定词，无法唯一落到单一 doc truth
- 如果继续优化 retrieval 排序，只是在迎合坏 truth，而不是提升系统真实性

当前 repo 约束：

- `campus_evals.validate_retrieval_qrels_fixture()` 会基于 split manifest
  检查这类短标题片段歧义
- `campus_evals.retrieval_benchmark` canonical runner 默认在评分前做
  preflight；未裁决歧义直接返回非零退出码

对 curriculum family alias，repo 级 truth authoring 进一步冻结如下：

- `基地班`、`实验班`、`创新班`、`民族班` 这类 generic family alias 默认不应写成单目标 `expected_sources`
- 不允许用 `profile memory` 或 `recent_goal` 作为 canonical single-doc truth 的唯一依据
- 若 case 使用 account-bound session context 或 typed memory 参与 disambiguation，必须同时满足：
  - query 本身带有 deictic/actor-grounded 语义
  - active candidates 被安全收敛到唯一当前有效 doc
- 这种 context 只能解释用户指代或偏好，不能成为 institutional source truth。
- 否则正确归宿仍是 clarification case 或 preflight error，而不是 retrieval qrels。

对更长期的 institution-scoped entity alias / course-family truth，进一步冻结如下：

- `course_family` alias 不得默认写成单一课程或单一 doc 的 canonical retrieval qrels
- `resolved_family` 可以是 completed truth，但 answer truth 必须按 family 语义书写
- family query 的 `expected_sources` 可以是 family-aware facts / member facts
  的受控集合，但不得伪装成单一成员课程 truth
- `思政课`、`思修课`、`思政`、`思政课程` 这类 institution-scoped family alias 的 canonical
  truth，不得在 authoring 时被 collapse 到 `习近平新时代中国特色社会主义思想概论`、`思想道德与法治` 或其他任意单课
- `民族实验班有哪些`、`实验班有哪些`、`创新班有哪些`、`创新实验班有哪些`、`名称里带实验班的培养方案有哪些`、`名称里带创新班的培养方案有哪些` 这类
  program-family membership / name-pattern 问句可以 author 成 family completed
  truth，但 answer/reference 必须按“当前已采集的名称集合”书写，不得伪装成任意单一培养方案
- `强基有哪些专业`、`强基计划有哪些专业`、`二学位有哪些专业`、`第二学位有哪些专业`、`第二学士学位有哪些专业` 这类 program-family
  membership 问句同样可以 author 成 family completed truth，但 short-fragment / deictic 单
  doc 语义仍不得被静默 author 成 single-doc qrels
- mixed query 若同时包含当前已支持字段和当前未采集字段，允许 partial-answer truth
- partial-answer truth 必须显式携带 forbidden claim：不得为 unsupported subfield 补猜事实

当前课程型 case 的 authoring posture 固定如下：

- `习概有哪些专业要上` 可写成单课 completed truth
- `思政课有哪些专业要上` 可写成 family completed truth
- `思政有哪些专业要上` 可写成 family completed truth
- `思政课包括哪些课` 可写成 family-membership completed truth
- `思政课程包括哪些课` 可写成 family-membership completed truth
- `习概第几学期开` 可写成单课 schedule completed truth
- `习概开设学期` 可写成单课 schedule completed truth
- `思政课第几学期开` 可写成 family schedule completed truth，但回答应按多课程结构化语义书写，不得捏成单值
- `思政第几学期开` 可写成 family schedule completed truth，但回答仍应按多课程结构化语义书写
- `思政课程第几学期开` 可写成 family schedule completed truth，但回答仍应按多课程结构化语义书写
- `民族实验班有哪些` 可写成 program-family completed truth
- `强基计划有哪些专业` 可写成 program-family completed truth
- `第二学士学位有哪些专业` 可写成 program-family completed truth
- `名称里带实验班的培养方案有哪些` 可写成 program-family name-pattern completed truth
- `名称里带创新班的培养方案有哪些` 可写成 program-family name-pattern completed truth
- `思政课是哪个学院开的` 在 `offering_unit` truth 尚未进入 serving surface 前，不得写成 completed
  factual truth
- `习概哪个学院开，第几学期开` 若当前系统接受 partial answer，则应把“可回答单课 schedule、不可回答
  offering_unit”写成明确 truth；回答既不得猜学院，也不得把未支持字段补成确定事实
- `思政课是哪个学院开的，有哪些专业要上` 若当前系统接受 partial answer，则应把“可回答 audience/cohort、不可回答
  offering_unit”写成明确 truth，而不是把 completed/no-answer 二选一硬化
- `思政课哪个学院开，第几学期开` 若当前系统接受 partial answer，则应把“可回答 family schedule、不可回答
  offering_unit”写成明确 truth；回答既不得猜学院，也不得把 family schedule 捏成单值

## RAGAS Projection 规则

当前 `build_ragas_projection()` 固定为：

- `retrieved_contexts` 优先使用 statement-level supporting contexts
- `retrieved_context_ids` 与 supporting contexts 同步的 stable source ID
- `reference` 优先 `reference_facts`，再回退 `required_facts`
- `reference_context_ids` 直接来自 case
- `reference_contexts` 直接来自 case

context metric 路由：

- 存在 `reference_context_ids` + `retrieved_context_ids` 时，优先 ID-based context
  metrics
- 否则回退 text-based context metrics

## Case Authoring Checklist

对 `expected_status="completed"` 的 case：

- 必须有 deterministic truth
- 若要进入 context metric，必须提供 `reference_context_ids` 或 `reference_contexts`
- 若是 title/article/topic lookup，应显式关闭 `answer_relevancy`
- 若保留 `answer_relevancy`，`user_goal` 应是自然问题句，而不是纯标题或纯条款号
- 若是 curriculum 的 resolved course/semester query，retrieved/supporting context
  truth 应明确约束为单一 `doc_id`；当 case 本身包含学期槽位时，context truth 还应只覆盖目标学期对应的
  row/context
- 若是 institution-scoped `course_family` query，`required_facts` 应按 family
  语义书写，不得要求回答伪装成单课
- 若 case 允许 partial answer，`required_facts` 与 `forbidden_claims`
  必须同时覆盖“哪些字段要答、哪些字段不得补猜”

## 当前 Handbook / Curriculum 约束

- `student_rules` 与 `curriculum_plan` 的 completed release/regression cases
  现在都应显式携带 context truth
- handbook `宿舍照明`、奖学金/公费医疗标题类 case 已按 lookup case 处理，不再默认进入 `answer_relevancy`
- curriculum 纯标题/方案名 exact-match case 同样按 lookup case 处理
- curriculum 的短标题片段歧义不得再锁成单目标 retrieval truth；`民族实验班` 现已迁移为 clarification
  lane，而不是 canonical qrels
- curriculum 的 resolved program/semester 问句不得再接受跨 doc、跨学期拼接出来的 answer/context
  truth；这类污染应视为 deterministic failure，而不是 soft metric 波动
