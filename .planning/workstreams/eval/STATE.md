---
workstream: eval
created: 2026-04-22
updated: 2026-05-10
---

# Project State

## Current Position

**Status:** completed
**Current Phase:** closed
**Current Phase Name:** Eval Workstream Closeout
**Current Plan:** `phases/phase-5b-golden-dataset-expansion-and-domain-case-governance/PLAN.md`
**Total Phases:** 14
**Total Plans in Phase:** 1
**Progress:** 14/14 phases complete
**Last Activity:** 2026-05-10
**Last Activity Description:** 重新 review eval workstream 后，将 Phase 5 拆为可立即推进的
case governance scaffold 与后置 golden dataset expansion；并登记 Phase 6-13 作为后续 eval closure
queue。随后完成 Phase 5A 的 lifecycle、denominator registry、workflow trace artifact shape 与
quality candidate intake scaffold；随后完成 Phase 6 workflow trace runtime gate、fixture family、
deterministic verdict 与 formal benchmark artifact adoption；随后完成 Phase 7 observed
regression review / dedupe / admission workflow；随后完成 Phase 8 public chat product-path
E2E eval seam、Phase 9 campus-services / notice tool-family denominator、Phase 10 multimodal/OCR
document quality eval、Phase 11 restricted/authz/privacy eval、Phase 12 agentic retrieval
plan/freshness eval 与 Phase 13 eval operations governance；本轮进一步将 Phase 8-13
observation-backed profiles 接入 `scripts.eval_gate`，补齐统一 `eval_profile_gate.v1`
artifact、artifact-derived operations observation、值级 redaction 与 scaffold denominator
扩展；随后新增 `multi-agent-product-path` deterministic gate，并把 workflow trace /
tool-family / public-chat product-path denominator 扩展到当前 multi-agent 产品路径；Phase 5B
已按 current-corpus eval contract 收口，认证态 canonical source 补采移交 backlog。最新补全将
runtime profile collection 收口到统一 `AppApiEvalClient`，
`profile-report.json` 增加真实 runtime metrics / `metrics_missing` 语义与 safe
`request_correlation`，新增 `publish-profile` backflow，扩展 workflow trace gate 到 tool
order / result status / fail-close provenance / evidence source selection，并将
`multi-agent-runtime-contract` 作为正式命名、`multi-agent-product-path` 作为 deprecated alias。
本轮继续补齐 profile registry / audit、tool routing、public chat entry E2E 与
answer-quality contract profiles，使 eval release gate 的 registry、workflow dispatch、
operations policy 与 fixture smoke 可被统一审计。2026-05-04 进一步收窄 RAG-only
eval denominator：仅覆盖 `regulations/student_rules`、`regulations/institutional_rules`、
`curriculum/curriculum_plan` 与 `official_web/stable_reference`，明确排除
`official_web/fresh_news`；`institutional_rules` 的 `institutional-rules-release-baseline`
composite gate 已纳入 RAG eval coverage/audit。RAG eval coverage report 已升级到 v2，
区分 minimum gate 与 maturity：当前 minimum gate 与 maturity gate 均通过，`student_rules`
与 `curriculum_plan` 已完成人工扩编并达到 baseline_ready。随后新增 core RAG 小样本
RAGAS diagnostic runner，并以 split-metric 方式完成 9-case 非阻塞诊断：context precision
稳定满分，context recall 暴露 scholarship 泛问多文档覆盖不足，answer relevancy 暴露若干
title/query 场景的 answer draft 选段偏离，faithfulness 仅保留 3-case smoke 以控制规模与耗时。
2026-05-08 将 Phase 5B 拆成 current-corpus 与 authenticated-gap 两层：当前已入库语料可以补
answer-quality contract 与 known-gap/no-hit contract；认证态缺失 canonical 文档被识别为
不能由相近文档或 notice 引用冒充 accepted truth 的 source gap。2026-05-10 按当前
workstream owner 边界完成 closeout：Phase 5B current-corpus 已由 coverage report、
answer-quality contract 与 known-gap/no-hit contract 收口；认证态 canonical 文档补采不再作为
eval blocker，而是移交 backlog seed
`.planning/seeds/SEED-005-authenticated-canonical-regulation-gap-collection.md`。

## Current Slice

- 这条 workstream 已完成 shared eval substrate 的前四层收口：
  - `packages/evals` shared core 从 handbook 语义收口到 neutral `formal_benchmark`
  - shared artifact contract 已冻结到 `docs/reference/eval-benchmark-artifact-contract.md`
  - `app-api` internal eval ingress 与 operator publish/backflow seam 已冻结到 contract/docs + code + tests
  - `scripts.eval_gate` 与 `.github/workflows/eval-release-gate.yml` 已成为 repo-owned automation entry
- Phase 5 已拆为两层：
  - `Phase 5A: Case Governance Scaffold`
    - completed
    - case lifecycle / review decision schema 已进入 `campus_evals.case_governance`
    - denominator registry scaffold 已进入 eval fixtures；RAG admitted denominator 已收口为
      `student_rules`、`institutional_rules`、`curriculum_plan` 与
      `official_web/stable_reference`
    - workflow trace summary / orchestration result artifact shape 已进入 formal benchmark
    - operator quality / feedback candidate intake manifest 已进入 `eval_admission`
    - drift / admission discipline 已由 registry validator 防止 denominator author truth
  - `Phase 5B: Golden Dataset Expansion And Domain Case Governance`
    - completed for current-corpus query-enabled surfaces
    - retrieval qrels shared governance
    - workflow/status accepted case expansion
    - deterministic answer truth expansion
    - known-gap/no-hit contract for missing canonical source
    - synthetic candidate promotion
    - authenticated canonical source collection moved to backlog seed; it is not an eval blocker
- `Phase 6: Workflow Trace Runtime Gate And Artifact Adoption`
  - completed
  - workflow trace case model / fixture family 已进入 `campus_evals.workflow_trace_gate`
  - direct / delegate / clarification / fail-close 最小 denominator 已进入
    `workflow_trace_gate_cases.v1.json`
  - deterministic verdict 已覆盖 branch、handoff、tool args、guardrail、fail-close 与 trace
    projection completeness
  - formal benchmark 可通过 `attach_workflow_trace_gate(...)` 将 verdict 写入
    `orchestration_case_results`
- `Phase 7: Observed Regression Intake And Review Workflow`
  - completed
  - operator badcase / negative feedback / incident-style pending manifest 可进入 repo-owned
    review workflow
  - review decision 支持 `accept`、`reject`、`duplicate`、`deprecated` 与 `needs_info`
  - accepted case 必须提供 rewritten eval-owned case payload
  - review workflow 输出 reviewed manifest 与 accepted observed regression fixture
- `Phase 8: Public Chat Product Path E2E Eval`
  - completed
  - public-chat product-path fixture family 已进入 `public_chat_product_path_cases.v1.json`
  - deterministic eval seam 覆盖 request / trace correlation、selected target、terminal outcome、
    response contract 与 operator backflow
  - artifact writer 输出 sanitized product-path report
  - profile 已接入 `scripts.eval_gate accept --profile public-chat-product-path`
  - scaffold denominator 已扩展到 schedule routing、clarification、notice title/url 与 no-hit
- `Phase 9: Campus Services And Notice Tool Eval Expansion`
  - completed
  - opened campus-services / notice tools 已进入 tool-family denominator fixture
  - deterministic evaluator 可区分 routing error、read-model gap、authorization fail-close 与
    missing observation
  - denominator registry 已登记 service / notice tool surfaces
  - profile 已接入 `scripts.eval_gate accept --profile tool-family-denominator`
  - scaffold denominator 已扩展到 temporarily unavailable、projection missing、argument ambiguity、
    not found、authorization denied 与 title/url card 分支
- `Phase 10: Multimodal / OCR / Document Quality Eval`
  - completed
  - document quality fixture 覆盖 required span、table header、confidence、projection target 与
    forbidden claim
  - gate 明确防止 OCR/视觉输出冒充 regulation-ready owner text
  - profile 已接入 `scripts.eval_gate accept --profile document-quality`
  - scaffold denominator 已扩展到 scanned PDF、table-heavy schedule 与 low-confidence false
    adoption 分支
- `Phase 11: Authorization / Privacy / Restricted Surface Eval`
  - completed
  - restricted/authz/privacy fixture 覆盖 restricted deny、policy unavailable 与 capability closed
  - eval artifact minimization guard 已扩展到 restricted/raw payload keys 与 token-bearing value
    scanning
  - profile 已接入 `scripts.eval_gate accept --profile authz-privacy`
- `Phase 12: Agentic Retrieval Plan / Freshness Eval`
  - completed
  - agentic retrieval plan fixture 覆盖 current、historical、compare、as-of 与 live freshness
    branch
  - deterministic evaluator 将 plan、freshness branch、live fail-close、supporting evidence 与
    final answer status 分开归因
  - profile 已接入 `scripts.eval_gate accept --profile agentic-retrieval-plan`
  - scaffold denominator 已扩展到 ambiguous query clarification 与 unsupported source fail-close
- `Phase 13: Eval Operations Governance`
  - completed
  - eval operations machine-readable policy 已进入
    `eval_operations_profile_policy.v1.json`
  - deterministic evaluator 覆盖 profile budget、timeout、retry、gate mode、failure
    disposition、quarantine readmission、retention 与 version drift
  - active runbook 已进入 `docs/runbooks/eval-operations-governance.md`
  - profile 已接入 `scripts.eval_gate accept --profile eval-operations-governance`
  - operations observation 可从 Phase 8-12 `profile-report.json` artifact 派生
- `Multi-Agent Product Path Gate`
  - completed as deterministic closure gate
  - profile 已接入 `scripts.eval_gate accept --profile multi-agent-runtime-contract`
  - `multi-agent-product-path` 仅保留为 deprecated alias
  - gate artifact 固定为 `multi-agent-runtime-contract-gate.json`
  - 当前 deterministic denominator：
    - workflow trace：10 条 case，覆盖 direct structured、campus-services、notice、knowledge
      delegate、ambiguous follow-up、fail-close 与 no-result
    - tool-family：28 条 case，覆盖 service / notice / `retrieval.query` 的 smoke、
      release_gate、regression_locked 与 exploratory split
    - public-chat product path：10 条 case，覆盖服务指南、班车、通知、follow-up、
      transactional fail-close、no-hit 与 policy unavailable
  - 该 gate 不启动 live local process，不跑 Docker smoke，不修改 serving admission，不产生
    operator publish dry-run case-results artifact
- `RAG Eval Coverage`
  - completed as a RAG-only coverage/audit slice
  - `packages/evals/src/campus_evals/rag_eval_coverage.py` 生成
    `rag-eval-coverage-report-v2`
  - `scripts.eval_gate audit` 已包含 `rag_eval_coverage` 与
    `rag_retrieval_quality_gate` 检查，前者防止 RAG denominator 重新混入非消费面或漏掉已
    admit 的 RAG surface，后者基于当前 runtime-readiness 与 live qrels evidence 阻断核心
    RAG retrieval 质量回退；maturity gaps 只报告，不让当前 audit fail
  - maturity policy:
    `packages/evals/fixtures/rag_eval_maturity_policy.v1.json`
  - manual authoring backlog:
    `packages/evals/fixtures/rag_eval_maturity_backlog.v1.json`
  - 当前 coverage evidence:
    `.planning/workstreams/eval/evidence/rag-eval-coverage/rag-eval-coverage.json`
  - 当前 retrieval quality gate evidence:
    `.planning/workstreams/eval/evidence/retrieval-quality/gate/rag-retrieval-quality-gate.current.json`
  - 当前 RAGAS diagnostic evidence:
    `.planning/workstreams/eval/evidence/retrieval-quality/ragas-diagnostic/ragas-diagnostic.combined.json`
  - RAGAS diagnostic 仅作为非阻塞质量诊断，不进入当前 release-blocking retrieval gate；当前
    执行口径为 core RAG 三条 surface：`regulations/student_rules`、
    `regulations/institutional_rules`、`curriculum/curriculum_plan`。`official_web/fresh_news`
    不属于本轮 RAG 消费面，`official_web/stable_reference` 仍保留在 coverage truth 但不纳入
    本轮 refreshed RAGAS diagnostic。
  - 当前 RAGAS 小样本结果：
    - `context_precision`: 9 cases，mean/min/max = `1.0 / 1.0 / 1.0`
    - `context_recall`: 9 cases，mean/min/max =
      `0.9166666666666666 / 0.25 / 1.0`
    - `answer_relevancy`: 9 cases，mean/min/max =
      `0.7468359492908837 / 0.5680662256246307 / 0.8859837318548726`
    - `faithfulness`: 3-case smoke，mean/min/max =
      `0.9398148148148149 / 0.875 / 1.0`
  - 当前 RAGAS low-score follow-up：
    - `semantic-scholarship-eligibility`: `context_recall = 0.25`，query 为
      “申请奖学金需要满足什么条件”；expected 覆盖 4 个 scholarship/aid policy docs，但 answer
      draft 只支撑 `handbook:a531a3c85de862c737d0576e957bf59598822c54`，属于泛问多政策覆盖不足。
    - `policy-alias-national-scholarship-article-nine`: retrieval 命中 expected doc，但
      `answer_relevancy = 0.5680662256246307`；draft 回答了体育竞赛条件，偏离用户问的
      “论文和著作”要求，属于 chunk/answer evidence selection 问题。
    - `ethnology-plan-title`、`history-strong-base-title` 与
      `digital-economy-plan-paraphrase`: retrieval 命中 expected curriculum doc，但 answer
      relevancy 低于 0.8；draft 倾向抽课程片段而不是返回标题级培养方案定位，属于
      curriculum title/query 的 answer drafting 口径问题。
  - 当前 RAG surface coverage:
    - `regulations/student_rules`: handbook profile，52 条 qrels，46 个 unique expected
      docs，25 条 release acceptance，新增 current-corpus answer-quality contract 与
      4 条 innovation-credit known-gap cases；minimum gate 通过，maturity status =
      `baseline_ready`
    - `regulations/institutional_rules`: `institutional-rules-release-baseline`，45 条 release
      qrels，42 个 unique expected docs，89 条 golden qrels，42 条 answer-quality cases，
      45 条 release acceptance；maturity status = `baseline_ready`
    - `curriculum/curriculum_plan`: curriculum profile，60 条 qrels，49 个 unique expected
      docs，30 条 release acceptance，新增 current-corpus answer-quality contract；
      minimum gate 通过，maturity status = `baseline_ready`
    - `official_web/stable_reference`: official-web stable-reference profile，10 条 qrels，5 条
      release acceptance；maturity status = `baseline_ready`
  - 当前 maturity gaps: none
  - `official_web/fresh_news` 当前记录为 excluded surface:
    `not_current_rag_consumption_surface`
  - 当前 core RAG retrieval quality gate 覆盖 `regulations/student_rules`、
    `regulations/institutional_rules` 与 `curriculum/curriculum_plan`；三条 surface 的 live
    qrels `doc_hit_at_1 = 1.0`、`doc_recall_at_5 = 1.0`、`forbidden_hit_rate = 0.0`，
    runtime readiness 均为 `ready`。`official_web/stable_reference` 仍保留在 coverage
    surface，但未纳入本轮 core RAG quality gate 的 refreshed blocking evidence。
- Eval closeout posture:
  - 当前没有独立编号的 Phase 14
  - `Total Phases = 14` 来自 Phase 5A/5B 拆分
  - `Phase 5B current-corpus` 已完成；认证态 canonical 文档缺口已移交 backlog seed
- 当前顺序保持冻结：
  - `Phase 5A` 不等待完整 corpus coverage；它只冻结流程、schema、denominator scaffold 与
    pending-review intake，不 author 大规模 domain truth；该切片已完成。
  - `Phase 5B current-corpus` 的 accepted eval contract 已完成；缺失 canonical 文档的 query
    只能进入 known-gap，不得进入 accepted qrels / answer truth。
  - authenticated canonical source 补采、source-truth import 与后续 accepted truth 晋升属于
    backlog/source-domain workstream，不属于 eval blocker。
  - `Phase 6` 已作为不依赖完整 corpus coverage 的 runtime gate 独立完成。
  - `Phase 7` 已作为不依赖完整 corpus coverage 的 review/admission workflow 独立完成。
  - `Phase 8-13` 已完成 deterministic eval seams，不抢占 `Phase 5B` 的 data-dependent status。
  - 当前没有独立编号的 Phase 14。
  - handbook / curriculum / official-web 现有 admitted eval surface 继续由已冻结的 runtime/artifact/publish/automation 承接
  - RAG-only coverage/audit 已完成 current-corpus closeout；新增 query-enabled surface 或新增
    canonical source 晋升时，按 denominator registry 和 case governance 重新 admission
- 当前明确排除：
  - domain case authoring 本体
  - retrieval / panel / tool feature 实现
  - operator read-model ownership
  - sink / grader 原始 payload 持久化真相

## Blockers

None.

## Residual Backlog

- 认证态 canonical regulation 补采与后续 accepted truth 晋升已移交
  `.planning/seeds/SEED-005-authenticated-canonical-regulation-gap-collection.md`。
- 在 canonical source 补采前，`rag_known_gap_cases.v1.json` 中的 innovation-credit cases
  继续阻止相近文档、notice 引用或 synthetic answer 被误标为 accepted qrels / answer truth。
- `docs/plans/archive/superseded/golden-dataset-execution-plan.md` 继续只保留为 supporting reference，不再承载 active progression。

## Verification

- Python eval/runtime verification:
  - `uv run --all-packages python -m unittest tests.evals.test_formal_benchmark tests.evals.test_live_benchmark tests.evals.test_handbook_live_benchmark tests.evals.test_curriculum_live_benchmark tests.evals.test_official_web_live_benchmark tests.evals.test_operator_observability tests.test_eval_gate tests.test_docs_structure`
  - `uv run --all-packages python -m unittest tests.evals.public_chat_product_path_eval_suite tests.evals.tool_family_denominator_suite tests.evals.document_quality_eval_suite tests.evals.authz_privacy_eval_suite`
  - `uv run --all-packages python -m unittest tests.evals.case_governance_suite tests.evals.workflow_trace_gate_suite tests.evals.test_intent_eval`
  - `uv run --all-packages python -m unittest tests.evals.agentic_retrieval_plan_eval_suite tests.evals.eval_operations_governance_suite tests.evals.case_governance_suite`
  - `uv run --all-packages python -m unittest tests.evals.test_eval_profile_gate tests.evals.test_eval_artifact_redaction`
  - `uv run --all-packages python -m unittest tests.evals.test_workflow_trace_gate tests.evals.test_tool_family_denominator tests.evals.test_public_chat_product_path_eval tests.evals.test_multi_agent_product_path_gate`
  - `uv run --all-packages python -m unittest tests.evals.rag_eval_coverage_suite tests.evals.rag_known_gap_suite tests.evals.answer_quality_contract_suite tests.evals.case_governance_suite tests.evals.profile_registry_and_audit_suite`
  - `uv run --all-packages python -m campus_evals.rag_eval_coverage --output .planning/workstreams/eval/evidence/rag-eval-coverage/rag-eval-coverage.json --json`
  - `uv run --all-packages python -m scripts.eval_gate accept --profile multi-agent-runtime-contract --output-dir .tmp/evals/multi-agent-runtime-contract-smoke --json`
  - `uv run --all-packages python -m scripts.eval_gate audit --json`
- JS/TS seam verification:
  - `pnpm --dir apps/app-api test:node -- test/chat-requests.route.test.ts`
- planning/docs consistency:
  - `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/eval/README.md .planning/workstreams/eval/ROADMAP.md .planning/workstreams/eval/STATE.md .planning/workstreams/eval/phases`

## Session Continuity

**Stopped At:** `eval` workstream completed. `Phase 1-4`、`Phase 5A`、`Phase 6`、`Phase 7`、
`Phase 8-13` 与 `Phase 5B current-corpus` 均已收口；RAG-only coverage/audit 已完成，且不把
`official_web/fresh_news` 计入当前 RAG eval denominator。当前没有独立编号的 Phase 14；
`Total Phases = 14` 来自 Phase 5A/5B 拆分。后续认证态 canonical source 补采从 backlog seed
恢复，不作为 eval blocker。
**Resume File:** `.planning/workstreams/eval/GAP-LEDGER.md`
