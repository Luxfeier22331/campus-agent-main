# campus-evals

Evaluation helpers for campus-agent v2.

`fixtures/` 用于保存 repo-tracked 的 live 验收查询样本、retrieval qrels 和 golden-style 输入集。

当前约束：

- `student_handbook_hybrid_queries.json` 负责 live hybrid rebuild/query 验收样本，不承担
  canonical retrieval qrels
- `curriculum_plan_hybrid_queries.json` 负责 `curriculum/curriculum_plan` 的 live
  hybrid/query 验收样本，不承担 canonical retrieval qrels
- retrieval 数值指标所需的 ground truth 应独立维护为专用 qrels fixture，避免与 live 抽样验收样本混用
- handbook live fixture 必须跟随当前 `regulations/student_rules` 的真实 collection
  边界收口；如果 handbook manifest 不再包含 `entitlement_groups`、`visibility_scope`
  或服务导航页等真相，这些 case 不应继续留在 handbook fixture 中
- curriculum live fixture 必须跟随当前 `curriculum/curriculum_plan` 的真实 manifest
  边界收口；重点覆盖标题命中、短事实 section、table retrieval、同专业不同方案区分、needs-clarification 与
  no-hit
- `policy_title_exact_match` 与 `fixed_phrase_sparse_win` 类 live 样本必须至少能锚定到当前
  handbook manifest 的标题关键词；相关 drift guard 由
  `tests/evals/test_retrieval_benchmark.py` 覆盖
- curriculum qrels 当前同样采取 `doc_id-level truth
  first`，第二学士学位、强基计划、创新班与课程教学计划是首批固定回归样本
- curriculum 课程 alias / family alias 现在额外有一条 internal `course_facts` serving
  surface：它不属于默认 external query-enabled scope，但 golden/scenario truth 会要求 agent
  在课程型问句上内部切换到这个 collection
- curriculum program-family alias 现在额外有一条 internal `program_family_facts`
  serving surface：`民族班有哪些` / `基地班有哪些` / `强基有哪些专业` / `二学位有哪些专业` / `实验班有哪些` /
  `创新班有哪些` 这类问句都应走 family-aware completed；其中 `实验班` / `创新班` 的 truth
  是“当前已采集、名称模式命中的培养方案集合”，不是官方统一 family taxonomy
- curriculum program + semester 课表问句现在额外有一条 internal `program_semester_facts`
  serving surface：像 `法学民族班培养方案里大二下有什么课` 这类 resolved single-doc + semester
  course-list 问句应优先切到这个 collection，而不是继续依赖 raw `curriculum_plan` table chunks
- `民族实验班有哪些`、`强基计划有哪些专业`、`第二学士学位有哪些专业`、`名称里带实验班的培养方案有哪些`、`名称里带创新班的培养方案有哪些`
  现在也属于固定 program-family completed lanes；full alias 与显式 name-pattern 问句都不能再退回
  doc-level qrels truth
- `习概有哪些专业要上`、`习概第几学期开`、`习概开设学期`、`思政课有哪些专业要上`、`思政课包括哪些课`、`思政课程包括哪些课`、`思政课第几学期开`、
  `思政第几学期开`、`思政课程第几学期开`、`思修课第几学期开` 与 mixed partial-answer case 现在属于固定 curriculum
  regression lanes；family alias 不得 collapse 到单课 qrels truth
- `民族班有哪些`、`民族实验班有哪些`、`基地班有哪些`、`强基有哪些专业`、`强基计划有哪些专业`、`二学位有哪些专业`、`第二学位有哪些专业`、`第二学
  士学位有哪些专业`、`实验班有哪些`、`创新班有哪些`、`创新实验班有哪些`、`名称里带实验班的培养方案有哪些`、`名称里带创新班的培养方案有哪些`
  现在都属于固定 program-family completed lanes；其中 full alias 与显式 name-pattern query
  也必须持续留在 regression gate
- curriculum deterministic gate 现在接受 `curriculum_plan ->
  course_facts/program_family_facts/program_semester_facts` 的内部切换；selected scope
  仍保持 `curriculum_plan`
- retrieval qrels preflight 现在会 fast-fail `思政课` / `思修课` / `思政` / `思政课程` 这类
  course-family alias，以及 `民族班有哪些` / `民族实验班有哪些` / `基地班有哪些` / `强基有哪些专业` /
  `强基计划有哪些专业` / `二学位有哪些专业` / `第二学位有哪些专业` / `第二学士学位有哪些专业` / `实验班有哪些` / `创新班有哪些` /
  `创新实验班有哪些` / `名称里带实验班的培养方案有哪些` / `名称里带创新班的培养方案有哪些` 这类 program-family
  membership alias 被 author 成单 doc canonical truth 的 fixture
- `我这个专业的实验班大二下有什么课` 这类 deictic curriculum 问句仍然不应因为 generic family alias 而静默落单
  doc；当前正确行为依旧是 clarification-first
- deictic curriculum truth 现在固定为：只有 `verified major + unique candidate` 才允许像
  `我这个专业的基地班大二下有什么课` 这样的问题进入 single-doc completed lane
- `recent_goal` / `confirmed_slot_terms` / profile-memory-only request overrides
  不得被 author 成 curriculum family alias 的 canonical single-doc qrels；这类 truth
  现在同样由 preflight fast-fail
- selected `regression_locked` retrieval qrels 现在已经开始锁到 `doc_id +
  version_id`；`chunk_id` 仍只在边界长期稳定后使用
- 默认 query-enabled retrieval surface 的 qrels 覆盖由
  `campus_evals.benchmark.validate_default_query_enabled_qrels_coverage()` 固定
  检查；它要求每个公开检索 scope 至少覆盖 positive、no-hit、forbidden 与 version
  locked 类样本，`institutional_rules` 还必须覆盖 authz case
- `institutional_rules` qrels 当前固定覆盖 30 条已发布校级制度 title-exact
  release-gate case，另加 semantic、authz-deny 与 no-hit guard；eval manifest 使用
  `configs/ingestion/regulations/institutional_rules/retrieval-eval-manifest.v1.json`
  锚定 30 条 current document/version truth，院级 `scoped_rules` 不得作为
  institutional qrels truth 或默认消费来源
- chunk 质量抽查由 `campus_evals.retrieval_chunk_quality.evaluate_chunk_quality()`
  固定表达；它检查 chunk 必备 traceability 字段、`root_unit_id` /
  `chunk_policy_version` provenance、重复 chunk id 与 token budget
- 生产观测回流由
  `campus_evals.retrieval_monitoring.build_retrieval_monitoring_backlog()` 固定表达；
  runtime observation 只生成 qrels / release metadata / authz / version 等候选 backlog，
  不直接改写 canonical qrels truth
- `campus_evals.scenarios` 现在同时提供 handbook / curriculum 的
  `smoke`、`regression_locked`、`release_gate` 与 `error_gate` 固定 case
  集；`release_gate` 继续服务 live gate，`smoke` / `regression_locked` 负责 repo-tracked
  常设回归样本
- `TraceExpectation.expected_runtime_target` 固定断言 raw runtime target；如需 report /
  display / family wording，使用 `expected_capability_family`，不要再把两种语义混成单个 handoff
  字段
- handbook / curriculum 的 retrieval annotation template 现在都需要与各自 qrels case
  inventory 保持一一对应，避免人工标注模板和 canonical qrels 漂移
- deterministic runner 现在接受 `AgentResponse` 与 `SupervisorResponse`
  两种执行结果；supervisor-only 终态额外覆盖 `approval_required_accuracy` /
  `rejection_accuracy`
- `ragas`、OpenAI graders 或其他 judge/scorer 只能作为 `packages/evals` 之后的 supplemental
  adapter，不得改写 canonical deterministic gate
- `student_rules` formal benchmark 的 policy / rubric fixture 分别固定在
  `student_handbook_judge_gate_policy.json` 与
  `student_handbook_judge_rubrics.json`
- intent eval 现在把 `release_gate`、`context_follow_up`、`version_compat`、
  `observed_regression` 与 `synthetic_regression` 作为默认 gate suites；observed
  regression truth 固定在 `intent_observed_regression.json`，只接受 review decision 为
  `accepted` 且带 request / trace / sampled_at correlation 的 case；synthetic truth
  固定在 `intent_synthetic_cases.v1.json`，只允许 `label_source=human_policy_matrix`
  的受控模板矩阵进入 gate，`synthetic_exploratory` 只用于报告与人工晋升，不属于默认 gate
- intent gate 报告现在携带 `case_set_version` 与 `policy_artifact` 摘要，来源为
  `configs/runtime/intent-policy.v1.json`；gate 结果必须绑定到具体 policy /
  classifier / intent schema / case-set 版本，而不是只记录通过数量
- `campus_evals.eval_admission intent-candidates` 只把 mined JSONL 包装成
  `pending_review` manifest，不会直接接收 golden truth；review / dedupe / expected truth
  修订完成后，才允许人工迁入 observed regression fixture
- `campus_evals.eval_admission quality-candidates` 只把 app-api operator quality
  eval-candidates export 包装成 `pending_review` manifest，支持 `operator_badcase` 与
  `negative_feedback`，不会直接接收 golden truth
- `campus_evals.observed_regression_review apply` 负责把 pending review manifest 与
  repo-owned review decision 合并，输出 reviewed manifest 与 accepted observed regression
  fixture；`accept` 必须提供 reviewer / reason / target suite / correlation 和重写后的
  eval-owned case payload，不能把 app-api candidate JSON 原样晋升
- `eval_denominator_registry.v1.json` 是 shared denominator registry scaffold，只表达每个
  admitted surface / tool / intake 当前应由哪些 eval family 覆盖，不 author domain truth
- formal benchmark case-results artifact 现在同时允许 `observed_trace`、
  `workflow_trace_summary` 与 `orchestration_case_results`；后两者是 workflow trace gate
  的 sanitized artifact surface，不保存 raw transcript、auth material 或 provider raw response
- workflow trace runtime gate 现在固定在
  `packages/evals/fixtures/workflow_trace_gate_cases.v1.json` 与
  `campus_evals.workflow_trace_gate`；它按 case expectation 确定性评估
  direct/delegate/clarification/fail-close branch、handoff target、selected tool、tool
  argument summary、tool call order、tool result status、fail-close provenance、evidence/source
  selection、guardrail outcome 与 trace projection completeness，并通过
  `attach_workflow_trace_gate(...)` 把 verdict 写入 formal benchmark 的
  `orchestration_case_results`
- public chat product-path eval 固定在
  `packages/evals/fixtures/public_chat_product_path_cases.v1.json` 与
  `campus_evals.public_chat_product_path_eval`；它只评估 sanitized request / trace
  correlation、selected target、terminal outcome、response contract 与 operator backflow
  summary，不保存 raw transcript 或 provider raw response
- public chat entry E2E eval 固定在
  `packages/evals/fixtures/public_chat_entry_cases.v1.json` 与
  `campus_evals.public_chat_entry_e2e`；它只验证 public chat 入口 request path、
  request / trace correlation、terminal outcome 与 response card/source contract，不把
  browser transcript 或 provider raw response 写入 artifact
- tool-routing product-path eval 固定在
  `packages/evals/fixtures/tool_routing_cases.v1.json` 与
  `campus_evals.tool_routing_product_path`；它用自然语言 user goal 评估 selected tool、
  terminal outcome、argument summary 与 response contract，和 tool-family denominator
  的读模型/工具结果覆盖保持分离
- answer-quality contract eval 固定在
  `packages/evals/fixtures/answer_quality_cases.v1.json` 与
  `campus_evals.answer_quality_contract`；它作为 answer contract 的确定性外壳，检查
  required facts、forbidden claims 与 title/source URL，不替代后续 domain golden dataset；
  institutional regulation consumption 使用
  `institutional_rules_answer_quality_cases.v1.json` 额外检查 required / forbidden
  source title and URL identity，确保校级制度回答不能由 `scoped_rules` 路径或
  scoped-rule promotion URL 满足
- campus-services / notice tool-family denominator 固定在
  `packages/evals/fixtures/tool_family_denominators.v1.json` 与
  `campus_evals.tool_family_denominator`；它覆盖 `service_status_lookup`、
  `transport_schedule_lookup`、`service_guide_lookup`、`contact_directory_lookup`、
  `campus_notice_discover` 与 internal selected notice resolve 的 `campus_notice_get`。
  其中 `campus_notice_get` 不是 provider/SDK tool denominator，只验证 source-card /
  bounded-summary / authorization fail-close posture；failure class 固定为 routing error、
  read-model gap、authorization fail-close 或 missing observation
- multimodal / OCR document quality eval 固定在
  `packages/evals/fixtures/document_quality_cases.v1.json` 与
  `campus_evals.document_quality_eval`；它覆盖 required span、table header、confidence、
  projection target 与 forbidden claim，防止 OCR/视觉输出冒充 owner-authored regulation
  truth
- restricted/authz/privacy eval 固定在
  `packages/evals/fixtures/authz_privacy_cases.v1.json` 与
  `campus_evals.authz_privacy_eval`；它覆盖 restricted deny、policy unavailable、
  capability closed 与 artifact minimization，forbidden raw key guard 也覆盖 restricted/raw
  payload keys
- agentic retrieval plan / freshness eval 固定在
  `packages/evals/fixtures/agentic_retrieval_plan_cases.v1.json` 与
  `campus_evals.agentic_retrieval_plan_eval`；它把 query decomposition、step plan、
  freshness/current/historical/as-of/compare branch、live fail-close、supporting evidence
  与 final answer status 分开归因
- eval operations governance 固定在
  `packages/evals/fixtures/eval_operations_profile_policy.v1.json`、
  `campus_evals.eval_operations_governance` 与
  `docs/runbooks/eval-operations-governance.md`；它评估 profile budget、timeout、retry、
  retention、failure disposition、quarantine readmission 与 version drift
- Phase 8-13 的 observation-backed deterministic profiles 已统一接入
  `campus_evals.eval_profile_gate` 与 `scripts.eval_gate`。这些 profile 输出
  `eval_profile_gate.v1` 的 `profile-report.json`，必须包含 `profile_id`、
  `case_family`、`summary`、`version_summary` 与 `sanitized_results`。runtime
  collection mode 必须写入真实 `started_at`、`finished_at`、`runtime_seconds`、
  `retry_count`、`provider_calls`、`collector_version` 与 `runtime_profile`；如果 artifact
  缺这些指标，必须显式标记 `metrics_missing=true`，并由 operations governance fail。profile
  report 可以在 `sanitized_results[].request_correlation` 保存 request / trace / sampled_at
  / safe backlink，用于后续 `publish-profile` 回流；仍然不得保存 raw prompt、provider raw
  response、auth material、restricted payload 或带 token/cookie 的 URL 值。
- `quality-calibration` 是 report-only profile，入口为：
  `uv run --all-packages python -m scripts.eval_gate accept --profile quality-calibration
  --observations-path <observations.json>`；它只汇总 public chat usefulness、OCR semantic
  quality 与 agentic plan quality 的 calibration 观察和 pending review candidates，不参与
  deterministic pass/fail canonical truth。
- `service_guide_lookup` release gate 是确定性组合 gate，入口为：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  service-guide-lookup`；
  它验证 service guide projection eval、service-guide intent 子集、
  supervisor-api Go planning/runtime/query tests 与 Python campus-services-agent
  contract tests，不打开 campus_services serving surface，也不产生 operator
  observability live case-results publish。
- `contact_directory_lookup` release gate 也是确定性组合 gate，入口为：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  contact-directory-lookup`；
  它验证 contact directory projection eval、contact intent 子集、
  supervisor-api Go planning/runtime/query tests 与 Python campus-services-agent
  contract tests，同样不产生 operator observability live case-results publish。
- `campus-services-product-path` opening gate 是 product-path admission gate，
  入口为：`uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path`；v2 artifact 用 `open_candidate` /
  `keep_closed` profile 区分正式开放工具和 later-wave 工具。当前
  `service_status_lookup`、`transport_schedule_lookup`、`service_guide_lookup`
  与 `contact_directory_lookup` 是 opened tools，`service_process_lookup`
  明确记录为 `keep_closed`。
- `multi-agent-runtime-contract` gate 是 supervisor-led multi-agent runtime contract
  的确定性组合 gate，入口为：`uv run --all-packages python -m scripts.eval_gate
  accept --profile multi-agent-runtime-contract`；它组合 workflow trace eval、
  tool-family denominator、public-chat product-path eval、supervisor execution
  schema/generated artifact 同步检查，以及 supervisor-api / app-api / panel targeted test
  lanes。该 gate 不启动本地 live process，不运行 Docker smoke，不修改 serving
  admission，不引入 Agents SDK，也不产生 operator observability live case-results publish
  dry-run artifact。`multi-agent-product-path` 暂保留为 deprecated alias；真实产品路径 E2E 使用
  `public-chat-product-path --collect-runtime` 和后续 public chat acceptance lane。
- `multi-agent-live-smoke` 是本地 direct-process live gate，入口为：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  multi-agent-live-smoke`；它顺序启动 `supervisor-agent-worker`、`supervisor-api`
  以及 notice profile 需要的本地最小 S3-compatible smoke endpoint，不启动 Docker /
  Wrangler。该 gate 覆盖 closed structured gate、terminal fail-close、RAG delegate、
  opened structured direct runtime、opened structured stream runtime、campus-services
  direct runtime、notice discover/detail direct runtime 与 terminal approval-required
  guardrail，并把真实 supervisor response 中的 `workflow_trace_summary` 回放到
  blocking workflow trace replay；process smoke 或 trace replay 任一失败都会使 gate 失败。
- `multi-agent-runtime-contract` 额外固定 cross-language supervisor execution fixture
  matrix：`tests/fixtures/supervisor_execution_contract/` 的 valid / invalid 样本必须同时被
  Python bridge DTO、Go strict decoder 与 TypeScript app-api adapter 覆盖，用来
  验证 `snake_case` strict wire、bridge version、enum、extra-field rejection、
  cancel / timeout / bridge unavailable terminal semantics。
- public-chat product-path eval 会 replay `workflow_trace_summary`，检查 selected target、
  direct/delegate/clarification/fail-close branch 与 fail-close reason 是否和产品路径 observation
  一致；panel targeted lane 只允许消费 app-api sanitized projection，并对 raw bridge /
  provider / prompt key 做非暴露断言。
- `multi-agent-runtime-contract` denominator 当前覆盖 12 条 workflow trace case、28 条
  tool-family case 与 10 条 public-chat product-path case。知识类 student_rules /
  curriculum_plan 仍通过 `retrieval.query` + `collection` 参数建模，不拆成入口 agent
  可直接调用的 flat tool。
- `workflow_trace_summary.workflow_mode` 现在是 canonical enum：
  `terminal`、`direct_runtime`、`single_handoff`、`multi_step`。当前 live runtime 已验证前三种，
  并新增受 gate 保护的首条 `multi_step` profile：selected notice context + knowledge
  follow-through，执行 internal selected notice resolve -> `rag-agent retrieval.query`。
  workflow trace gate 会拒绝把单个 handoff projection 伪装成 `multi_step`；completed
  `multi_step` 至少需要两段 handoff chain，并且需要 cross-step context 的路径必须提供
  `workflow_trace_summary.context_projections` sanitized summary。resume 与 semantic
  retry/replan 仍需独立 eval denominator。
- eval profile registry 固定在 `campus_evals.profile_registry`。`scripts.eval_gate audit`
  会校验 registry runner、GitHub Actions dispatch choices、operations policy、denominator
  registry、tool-family fixture coverage 与 profile fixture smoke；新增 profile 时必须同步这些
  surface。

## Orchestration / Workflow Trace Eval Gap

当前 eval 已经覆盖 retrieval qrels、intent gate、observability publish、formal
benchmark artifact、supplemental judge / ragas adapter、`service_guide_lookup`
release gate 与 shared workflow trace runtime gate。后续缺口不再是 artifact/gate
shape，而是把更多真实产品路径和 domain-specific case 扩编进这些 gate。

需要补齐的 shared suite family：

- `workflow_trace`
  - 已有 shared gate；当前覆盖 direct structured、campus-services handoff、notice handoff、
    knowledge delegate、ambiguous follow-up、fail-close 与 no-result 产品路径
  - `workflow_mode` 只接受 `terminal`、`direct_runtime`、`single_handoff`、`multi_step`；
    `multi_step` trace 必须至少有两段 handoff chain，避免把当前单 handoff projection
    冒充成多步 workflow
- `direct_vs_delegate`
  - 验证 Go structured runtime / non-delegate terminal / Python delegate 三类分支是否命中
    expected truth
- `tool_argument_precision`
  - 验证 selected tools、retrieval plan、structured lookup subtype、source channel、temporal
    scope、doc / version / service id 等参数是否精确
- `handoff_correctness`
  - 验证 selected target、`AgentRequest` 的 capability family、target、allowed tools、
    context resolution、missing slots 与 policy reason 是否和 case truth 对齐
- `agent_escalation_fail_close`
  - 验证 capability closed、scope disabled、policy unavailable、missing context、ambiguous
    follow-up 与 unauthorized visibility 的 terminal outcome

这些 suite 的 canonical truth 仍属于 repo-owned fixtures / artifacts；OpenAI Evals /
Agents SDK traces、RAGAS、Sentry、Axiom 或其他外部系统只能作为 trace/debug sink、
supplemental grader 或 candidate mining input。accepted artifact 必须只保存 sanitized
workflow summary、request / trace correlation、版本摘要与 safe links，不保存 raw
transcript、provider raw response、auth material 或未经裁剪的 restricted payload。

配套文档：

- `docs/reference/student-handbook-eval-metrics.md`
- `docs/reference/curriculum-plan-eval-metrics.md`
- `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md`
- `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`

验证命令：

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases
  tests.evals.test_retrieval_benchmark`
- `uv run --all-packages python -m unittest tests.evals.test_golden_cases
  tests.evals.test_retrieval_benchmark tests.evals.test_supplemental_adapters`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_core tests.agent.test_rag_agent
  tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark`
- `curriculum` live benchmark 也复用同一 scorer，只需将 `--qrels` 切换为
  `packages/evals/fixtures/curriculum_plan_retrieval_qrels.json`
- `uv run --all-packages python -m unittest tests.evals.test_intent_eval`
- `uv run --all-packages python -m scripts.intent_gate`
- `uv run --all-packages python -m scripts.intent_gate --suite synthetic_exploratory
  --report-only --output .tmp/evals/intent-synthetic-exploratory.json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup
  --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  contact-directory-lookup --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  multi-agent-runtime-contract --json`
- `uv run --all-packages python -m scripts.eval_gate audit --json`
- `uv run --all-packages python -m unittest
  tests.evals.public_chat_product_path_eval_suite
  tests.evals.tool_family_denominator_suite
  tests.evals.document_quality_eval_suite
  tests.evals.authz_privacy_eval_suite`
- `uv run --all-packages python -m unittest tests.evals.case_governance_suite
  tests.evals.workflow_trace_gate_suite tests.evals.test_intent_eval`
- `uv run --all-packages python -m unittest
  tests.evals.agentic_retrieval_plan_eval_suite
  tests.evals.eval_operations_governance_suite`
- `uv run --all-packages python -m unittest tests.evals.test_eval_profile_gate
  tests.evals.test_eval_artifact_redaction`

observation-backed profile gate CLI：

- `uv run --all-packages python -m scripts.eval_gate accept --profile
  public-chat-product-path --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  tool-family-denominator --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  document-quality --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  authz-privacy --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  agentic-retrieval-plan --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  eval-operations-governance --artifact-path <profile-report.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  tool-routing-product-path --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  public-chat-entry-e2e --observations-path <observations.json> --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  answer-quality-contract --observations-path <observations.json> --json`

retrieval benchmark CLI：

- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels
  packages/evals/fixtures/student_handbook_retrieval_qrels.json --results
  <run-results.json>`
- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels
  packages/evals/fixtures/curriculum_plan_retrieval_qrels.json --results
  <run-results.json>`
- `uv run --all-packages python -m campus_evals.retrieval_live_benchmark --qrels
  packages/evals/fixtures/institutional_rules_retrieval_qrels.json --output
  <institutional-live-run.json> --format json --top-k 3`
- `run-results.json` 输入形状为 `{"schema_version": 1, "cases": [{"case_id": "...",
  "retrieved_sources": [{"doc_id": "...", "version_id": "...", "chunk_id":
  "...", "score": 0.9}]}]}`
- 默认输出 text summary；加 `--format json` 输出 aggregate 指标与 `by_split` 汇总
- 默认 query-enabled retrieval scopes 的 qrels denominator 由
  `campus_evals.benchmark.default_query_enabled_retrieval_qrels_paths()` 固定：
  `regulations/student_rules`、`regulations/institutional_rules`、
  `curriculum/curriculum_plan` 与 `official_web/stable_reference`
- 默认 query-enabled qrels 不只检查 case count / positive / no-hit / forbidden /
  version/authz classes；fixture 还必须声明 `coverage_scenarios`，并把每个 required
  scenario 绑定到已存在的 case id。缺 scenario 或 scenario 引用不存在的 case 都会让
  `validate_default_query_enabled_qrels_coverage()` fail。
- 对没有静态 `split-manifest.v1.json` 的 projection-derived scope，qrels validation
  可使用同目录 `retrieval-eval-manifest.v1.json` 作为 deterministic eval manifest；
  该 manifest 只服务 qrels anchoring，不替代 registry / release manifest truth
- release publish acceptance 与 formal qrels 分开维护：例如
  `regulations/student_rules` 发布 alias 时使用
  `packages/evals/fixtures/student_rules_release_acceptance.v1.json`
  作为 doc-level hard gate；`student_handbook_retrieval_qrels.json` 继续服务
  formal benchmark、no-hit、forbidden hit、version-locked recall 与 tuning，不直接作为
  alias publish gate

retrieval tuning CLI：

- `uv run --all-packages python -m campus_evals.retrieval_tuning --qrels
  packages/evals/fixtures/student_handbook_retrieval_qrels.json --candidate
  <candidate-run.json> --candidate <candidate-run.json> --runtime-profile
  configs/ingestion/regulations/student_rules/runtime-profile.json --output
  <tuning-report.json>`
- `candidate-run.json` 输入形状为
  `{"schema_version": "retrieval-tuning-candidate-run-v1", "candidate_id": "...",
  "profile": {"dense_prefetch_limit": 20, "sparse_prefetch_limit": 20,
  "rrf_k": 60, "rrf_dense_weight": 1.0, "rrf_sparse_weight": 1.0,
  "no_hit_min_top_score": 0.6, "no_hit_min_score_gap": 0.1}, "cases": [...]}`;
  `cases` 与 retrieval benchmark `run-results.json` 一致
- tuning report 会对 positive hit@3 / doc recall@5、no-hit、forbidden hit、version-locked
  recall 做 deterministic gate，并只在候选通过 gate 时输出 `recommended_profile_patch`
- tuning runner 只生成 evidence-backed recommendation，不会自动修改 production
  `runtime-profile.json`，也不会扩大 query-enabled scope

retrieval monitoring backlog CLI：

- `uv run --all-packages python -m campus_evals.retrieval_monitoring_cli
  --observations <sanitized-runtime-observations.jsonl> --output
  <retrieval-monitoring-backlog.json>`
- observation JSONL 输入必须是脱敏后的 runtime/operator artifact；典型字段包括
  `request_id`、`timestamp`、`scope`、`query`、`terminal_state`、`candidate_count`、
  `top_score`、`score_gap`、`failure_kind`、`release_id`、`profile_hash`
- 输出只生成 deterministic backlog candidate；它不会自动改 qrels fixture、
  `runtime-profile.json` 或 release manifest

supplemental adapter seam：

- `run_cases(..., supplemental_adapters=(...,))` 可在 deterministic verdict 之外附加
  report-only 评分
- `campus_evals.ragas_adapter.build_ragas_projection()` 负责把仓库自有 `GoldenCase +
  ExecutionResult` 投影成 `ragas` 友好的 `user_input / response / retrieved_contexts /
  reference`
- `GoldenCase.required_facts` 继续服务 deterministic completeness；如需 richer
  supplemental reference，使用 `GoldenCase.reference_facts`
- `GoldenCase.reference_context_ids` / `reference_contexts` 负责 supplemental
  context truth；当前优先 `reference_context_ids`
- `GoldenCase.supplemental_metric_overrides` 用于显式关闭不适用的 supplemental metric，例如
  title/article lookup case 的 `answer_relevancy`
- `campus_evals.ragas_adapter.RagasSupplementalAdapter` 只负责 supplemental
  评分接线，不影响 `CaseResult.passed`
- `RunReport.by_supplemental` 单独聚合 adapter 指标，和 `by_metric` 的 deterministic gate
  分离

live benchmark profile/core：

- `campus_evals.live_benchmark.BenchmarkProfile` 负责冻结 live benchmark 的 case
  set、executor、supplemental adapters、policy path 与 artifact prefix
- `BenchmarkProfile.http_settings` 是 benchmark runtime tuning 的 repo-tracked
  ownership，承载 timeout / retry / pacing / keep-alive / connection-pool 默认值
- `campus_evals.live_benchmark.run_live_benchmark_profile(...)` /
  `repair_live_benchmark_profile(...)` 在 shared formal benchmark core 之上提供
  profile-based run/repair wrapper
- `campus_evals.handbook_live_benchmark` 与
  `campus_evals.curriculum_live_benchmark` 现在都只是 profile entrypoint；新增 corpus
  时优先加 profile，不再复制一整套 runner

ragas runtime：

- 共享 provider 真相默认来自 `LLM_*` 与 `EMBEDDING_*`
- `campus_evals.settings.RagasSettings.from_env()` 的 provider 解析优先级固定为
  `EVAL_LLM_* > LLM_*` 与 `EVAL_EMBEDDING_* > EMBEDDING_*`
- `campus_evals.settings.JudgeLLMSettings.from_env()` 的 provider 解析优先级固定为
  `EVAL_LLM_* > LLM_*`
- `EVAL_LLM_*` / `EVAL_EMBEDDING_*` 只用于 eval 需要独立 provider、独立预算或独立限流的场景；默认不再作为
  root `.env` 主真相
- repo 主路径里的 ragas / judge HTTP runtime tuning 不再从 env 读取，而是由
  `BenchmarkProfile.http_settings` 显式注入
- low-level helper 仍保留
  `SupplementalHTTPSettings.from_env(...)`，仅用于显式本地实验或测试，不再作为长期 benchmark
  ownership
- ragas model 现在只接受 `EVAL_RAGAS_MODEL`
- judge model 现在只接受 `EVAL_JUDGE_MODEL`，未单独配置时回退到 `EVAL_RAGAS_MODEL`
- eval LLM transport 现在显式由 `EVAL_LLM_TRANSPORT` 持有，并允许
  `EVAL_RAGAS_LLM_TRANSPORT` / `EVAL_JUDGE_LLM_TRANSPORT` 做 surface
  override；允许值固定为 `responses` 或 `chat_completions`
- 默认运行面仍走 `build_http_ragas_llm()` + `build_http_ragas_embeddings()`；LLM
  transport 会按当前 env 对 OpenAI-compatible `/responses` 或 `/chat/completions` 发原生
  HTTP 请求，embeddings 固定走 `/embeddings`，实现边界固定在 `campus_evals.supplemental_http`
- `BenchmarkProfile.http_settings` 现在统一控制 ragas + rubric judge 共享的 supplemental
  provider runtime，包括 connect/read/write/pool timeout、单层 retry、provider runtime
  circuit breaker、preflight timeout、request pacing 与 keep-alive
- pacing / breaker 的共享粒度已经收口到 `provider origin + api key`，避免不同 credential 互相污染
  rate budget
- 若需要针对某类 benchmark profile 单独调整 pacing，应修改 repo-tracked profile config，而不是再向
  root `.env` 添加新键
- internal shared transport 现在会复用 sync/async HTTP client，并把 keep-alive expiry
  提升到适配低 RPM provider 的窗口；重复 preflight 会命中同一 runtime signature 的缓存，不再重复消耗
  provider 预算
- preflight 现在承担 run-level availability gate：
  - `transient_retryable` / `hard_unavailable` 会把对应 supplemental adapter 标成
    `skip_adapter`
  - `non_retryable_request` 会在写出 `supplemental-preflight.json` 后直接中止
    benchmark，避免继续生成误导性 0 分 artifact
- ragas preflight 只探测当前选中 LLM transport 的 text endpoint 加 `/embeddings` 可用性，不再把
  structured `json_schema` 探针失败误判成 ragas runtime 整体不可用
- preflight 失败现在会写出 `failure_disposition` 与 `run_action`，并同步把 runtime breaker /
  preflight cache 置入 fast-fail 状态
- judge/ragas LLM payload 都支持独立低延迟 profile：`RAGAS_REASONING_EFFORT`、`RAGAS_TEXT_
  VERBOSITY`、`RAGAS_MAX_OUTPUT_TOKENS`
- `n>1` 的 ragas judge 调用现在会在同一 async transport 上并发发出，不再串行放大单 metric 延迟
- `Qwen3-Embedding-4B` 未显式配置 `EMBEDDING_DIMENSIONS` 时，eval 侧默认补成 `2560`
- pinned `ragas==0.4.3` 当前通过 `ragas.evaluate(...)` + legacy metric objects
  执行真实评分；默认 scorer 现在直接接 `BaseRagasLLM` / `BaseRagasEmbeddings` 的原生 HTTP 实现
- repo-shipped eval CLI 会在本地自动 bootstrap 当前 worktree `.env`
- ad-hoc `uv run ... python - <<'PY'` / REPL 仍不会自动读取 `.env`；这类临时脚本需要先 `set -a &&
  source .env && set +a`，或显式调用 `campus_shared.load_repo_env()`
- 如果要确认当前 worktree 的 eval provider/env 是否真正可见，优先使用：
  - `uv run --all-packages python -m scripts.doctor_env evals --json`
  - 该命令会报告 bootstrap state、checked key order、resolved key source 与 model
    presence，但不会打印 raw secret values

最小 smoke（ad-hoc inline Python）：

- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run
  --package campus-evals python - <<'PY'`
- `from campus_evals import RagasProjection, RagasSettings, build_ragas_scorer`
- `settings = RagasSettings.from_env()`
- `scorer = build_ragas_scorer(settings)`
- `print(scorer(RagasProjection(case_id="smoke", user_input="学校图书馆开放时间是什么？",
  response="图书馆开放时间为 08:00 到 22:00。", retrieved_contexts=("图书馆开放时间为
  08:00-22:00。",), reference="图书馆开放时间为 08:00-22:00。")))`
- `PY`

provider 诊断约定：

- shared provider precedence 已收口到 `campus_shared.provider_config`
- eval LLM provider key 优先级固定为 `EVAL_LLM_API_KEY > LLM_API_KEY`
- eval embedding provider key 优先级固定为 `EVAL_EMBEDDING_API_KEY >
  EMBEDDING_API_KEY`
- provider key 缺失现在会给出 surface-aware typed error，而不是只报笼统 `LLM_API_KEY is
  required`
- deploy-side provider secret 治理见 `docs/runbooks/provider-secret-governance.md`

student handbook formal benchmark：

- `campus_evals.formal_benchmark.run_formal_benchmark(...)` 负责把 live
  release-gate case 集重跑多轮，并落盘：
  - `supplemental-preflight.json`
  - `run-XX-case-results.json`
  - `run-XX-summary.json`
  - `summary.json`
  - `gate-report.json`
  - `SUMMARY.md`
- `run-XX-case-results.json` 现在会直接内嵌每个 case 的 `request_correlation`；如果 live
  executor 走 `app-api` internal eval ingress，这里会包含 canonical `request_id` /
  `trace_id`，后续 operator publisher 可直接消费，不再强依赖额外 manifest
- `campus_evals.formal_benchmark.collect_repairable_benchmark_targets(...)` 会从既有
  artifact 中筛出可修复的 supplemental infra failure：
  - 已写入 case 结果的 transient runtime failure
  - `supplemental-preflight.json` 中被 `skip_adapter` 跳过、后续可 backfill 的
    unavailable metrics
  - 不接受低分 case 作为 repair target
- `campus_evals.formal_benchmark.repair_formal_benchmark(...)` 会在新目录里生成 repair
  artifact，不会改写原 formal benchmark 目录：
  - `repair-config.json`
  - `repair-plan.json`
  - `run-XX-repair-results.json`
  - repaired `run-XX-case-results.json`
  - repaired `run-XX-summary.json`
  - repaired `summary.json`
  - repaired `gate-report.json`
  - repaired `SUMMARY.md`
- repair rerun 只用于 transient infra failure：
  - `429`
  - `5xx`
  - timeout
  - transport error
  - provider runtime marker，例如 `do_request_failed`
- repair rerun 的 provenance 固定写入 repaired `summary.json` / `gate-report.json`；原
  benchmark artifact 保持不可变
- `gate-report.json` 只解释 supplemental judge/ragas 阈值，不替代 deterministic gate
- 当前 `student_rules` policy fixture 全部是 `soft_gate`；`warn` 表示 supplemental
  指标未达阈值，不表示 handbook 主链路 deterministic 回归失败
- 当某个 supplemental metric 没有任何可计分 observation，且失败全部来自 retryable runtime /
  provider outage 时，aggregate 会显式写出 `overall.runtime_status=unavailable`
- 这种场景的 gate reason 会包含 `runtime_unavailable`，而不会再错误地追加 `*_below_threshold` 或
  `run_average_drift_above_threshold`
- 当 supplemental preflight 在 run 开始前就判定 provider unavailable 时：
  - formal benchmark 会继续 deterministic 主链路，但不会再执行对应 supplemental adapter
  - `summary.json` 会为被跳过的 metric 合成 `overall.runtime_status=unavailable`、`prefli
    ght_failure_count=1`、`skip_reason=preflight_unavailable`
  - repair rerun 会把受影响 target 记为 `skipped_provider_unavailable`，不再盲目重放 case
- repair rerun 如果已经执行但 replacement 仍是 `verdict=failed` 且 `score=null` 的
  unresolved runtime failure：
  - target 会记为 `rerun_failed`
  - 只有真正恢复出分数或 `not_applicable` 的 metric 才会进入 `repaired_metric_keys`
  - 同一 target 若只恢复部分 metric，则会记为 `partially_repaired`
- handbook live runner 现已固定为 `campus_evals.handbook_live_benchmark`：
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark run
    --reruns 3`
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark repair
    --benchmark-dir <formal-benchmark-dir>`
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark accept
    --reruns 3 --verbose --log-jsonl .tmp/evals/handbook-runtime-events.jsonl`
  - 默认入口现在优先通过 `app-api` internal eval ingress 进入真实产品 command path，生成 canonical
    `request_id` / `trace_id`
  - 本地运行前，需要先启动 repo-local `supervisor-api` 与 `app-api` dev runtime，并在 root
    `.env` 提供 `APP_API_BASE_URL`、`APP_API_INTERNAL_SHARED_SECRET`、`APP_API_EVAL_
    USER_EMAIL`
  - 这些 `APP_API_*` 只描述当前 worktree 的本地 eval ingress，不是远端部署环境真相；其中
    `APP_API_INTERNAL_SHARED_SECRET` 必须与本地 `apps/app-api/.dev.vars` 保持同值
  - 如需让 acceptance artifact 直接产出 panel-safe backlink，可选配置： -
    `APP_API_EVAL_TRACE_LINK_TEMPLATE` - `APP_API_EVAL_ISSUE_LINK_TEMPLATE` -
    `APP_API_EVAL_ISSUE_FINGERPRINT_TEMPLATE`
- 当前模板变量固定为 `case_id`、`request_id`、`trace_id`、`conversation_id`、`status`、`select
  ed_target`、`corpus`、`collection`
  - 其中 `selected_target` 继续只表示 raw runtime target correlation
    field；report/display 需要 family wording 时应显式派生独立标签
  - 如需保留 trace-rich agent/retrieval 单元行为，测试或局部调试应显式使用
    `build_inprocess_handbook_live_executor(...)`
- curriculum live runner 现已固定为 `campus_evals.curriculum_live_benchmark`：
  - `uv run --all-packages python -m campus_evals.curriculum_live_benchmark run
    --reruns 3`
  - `uv run --all-packages python -m campus_evals.curriculum_live_benchmark
    repair --benchmark-dir <formal-benchmark-dir>`
  - `uv run --all-packages python -m campus_evals.curriculum_live_benchmark
    accept --reruns 3 --verbose --log-jsonl
    .tmp/evals/curriculum-runtime-events.jsonl`
  - 该入口通过 shared `BenchmarkProfile` core 显式绑定
    `curriculum_plan_live_gate_policy.json`，不再默认回退到 handbook policy
  - 默认入口同样优先走 `app-api` internal eval ingress；包含 deterministic `failure_mode` 的
    case 仍显式回退 in-process executor，保证错误注入可控
  - 本地运行前提与 handbook live runner 相同；root `.env` 里的 `APP_API_*` 仍只表示本地 eval
    ingress 参数
  - backlink 模板配置同 handbook live runner
- official-web live runner 现已固定为 `campus_evals.official_web_live_benchmark`：
  - `uv run --all-packages python -m campus_evals.official_web_live_benchmark
    run --reruns 1 --qdrant-collection-name <physical-collection>`
  - `uv run --all-packages python -m campus_evals.official_web_live_benchmark
    repair --benchmark-dir <artifact-dir> --qdrant-collection-name
    <physical-collection>`
  - `uv run --all-packages python -m campus_evals.official_web_live_benchmark
    accept --reruns 1 --qdrant-collection-name <physical-collection>`
  - `uv run --all-packages python -m campus_evals.official_web_live_benchmark
    run --reruns 1 --official-web-scope stable_reference
    --qdrant-collection-name <physical-collection>`
  - `uv run --all-packages python -m campus_evals.official_web_live_benchmark
    run --reruns 1 --official-web-scope fresh_news --qdrant-collection-name
    <physical-collection>`
  - 该入口只做本地 deterministic 验证：通过 monkeypatch 临时打开所选 `official_web/*` scope 的
    retrieval，并把 alias 指向指定 unpublished physical collection；repo-tracked
    `offline_preparation` truth 不会被命令行改写

runtime observability artifact：

- `run` / `repair` 默认都会在 benchmark 目录下写：
  - `supplemental-runtime-events.jsonl`
  - `supplemental-provider-summary.json`
- `accept` 会在 acceptance 根目录额外写：
  - `accept-config.json`
  - `final-summary.json`
- 若 `accept` 显式启用 operator publish，还会额外写：
  - `operator-observability-publish-summary.json`
- `accept` 现已支持把最终使用的 `run-XX-case-results.json` 直接回流到 `app-api` 的 operator
  observability ingest seam：
  - `--publish-operator-observability`
  - `--publish-operator-observability-dry-run`
  - `--publish-grade-source <stable-source-id>`
  - `--publish-grader-version <stable-version>`
  - `--publish-metric-domain-override adapter.metric=grounding|citation|policy`
  - `--publish-request-correlations <path>` 仅在仍需外部 manifest 时使用；默认优先消费
    case-results 内嵌 `request_correlation`
  - 当前 publish batch 同时消费： - `supplemental_results` 中可发布的 grounding / citation /
    policy grader 结果 - `metric_results` 中已映射的 deterministic refusal 指标，例如 `deter
    ministic.out_of_scope_accuracy`、`deterministic.unsupported_abstention_accura
    cy`、`deterministic.false_refusal_rate`、`deterministic.unsafe_false_allow_rat
    e`
- `--log-jsonl` 会把 `accept` 的 runtime log 路径拆成 `<base>.run.jsonl` 与
  `<base>.repair.jsonl`
- `--verbose` 现在会直接打印 preflight、retrying、recovered、breaker opened / fast-fail
  等高信号事件，便于 live 验收时确认瞬时 provider 错误是否已经被自动重试
