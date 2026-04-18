---
doc_type: plan
status: historical
created: 2026-04-03
updated: 2026-04-12
---

# Local Live Eval Canonical Registry Recovery

## 当前状态

本文状态固定为 `historical`。

原因：

- 它记录的是一次 repo-local canonical registry recovery / closeout 过程
- 当前 live eval 的可消费真相应优先看 runbooks、reference 与 `.planning/` 中的最新状态
- 本文保留 incident diagnosis、修复路径与 closeout 证据，不再作为默认前向执行入口

## 文档边界

本文只负责 repo-local `curriculum_plan` 与 `student_handbook` live accept 的恢复方案。

本文不负责：

- 重新定义长期 identity / authorization architecture
- 为 runtime query path 重新引入 `acl_groups`、`campus_scope`、`acl_level` 兼容
- 把本地 eval ingress 参数误记成远端 deploy secret
- 替代 release-managed rebuild / alias publish runbook

对应 source of truth：

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/plans/legacy-acl-carrier-compatibility-sunset.md`
- `docs/runbooks/index-release-runbook.md`
- `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`
- `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md`

## 2026-04-10 补充收口

本轮新增收口结论：

- 新的 curriculum follow-up replay 失效根因已经确认不是 session slot 或 recent-goal 逻辑，而是 cloud Qdrant 当前 alias 下缺失 `curriculum/program_semester_facts`
- `program_semester_facts` 的正确恢复入口不是回到 raw/source bucket 重做 `provider_response_replay`，而是从 canonical `curriculum_plan document-units` 重新物化 derived scope
- repo 现已具备正式 operator 入口：

```bash
uv run --all-packages python -m campus_ingestion_worker.materialize_curriculum_program_semester_facts
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope --corpus curriculum --collection program_semester_facts --no-publish-alias
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope --corpus curriculum --collection program_semester_facts --publish-alias
```

这轮真实证据：

- canonical scope materialization：
  - `source_document_count=69`
  - `materialized_document_count=380`
  - `raw_asset_id=asset:curriculum-plan-2022`
  - `raw_version_id=sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67`
  - `source_pdf=curriculum-plan-2022.pdf`
- preview release：
  - `release_id=r20260410_130216`
  - `physical_collection_name=program_semester_facts__r20260410_130216`
  - `point_count=392`
  - `validation_status=passed`
- publish release：
  - `release_id=r20260410_131101`
  - `physical_collection_name=program_semester_facts__r20260410_131101`
  - `point_count=392`
  - `validation_status=passed`
  - `published_at=2026-04-10T13:12:30.926053+00:00`
- current alias：
  - `program_semester_facts -> program_semester_facts__r20260410_131101`
- live specialist replay：
  - `法学 / 历史学` 两组 program-fragment 与 semester-fragment follow-up 都已直接命中 `program_semester_facts`
  - direct retrieval 与 `delegate_to_rag_agent(...)` 两层验证均返回 `semester-4` 目标 doc，law/history answer 已恢复

## 触发背景

2026-04-03 的两轮 repo-local live accept 都已经跑完，但它们当前不能被当成有效质量结论：

- `.tmp/evals/curriculum-plan-live-gate-accept-20260403T220918`
- `.tmp/evals/student-handbook-formal-benchmark-accept-20260403T222115`

这两轮 run 暴露了两个串行问题：

1. 本地 `supervisor-api` 最初仍按 `bearer + 8080` 启动，而 `app-api` eval bridge 需要的是 `trusted-worker + 8081`。
2. 把本地 auth 模式纠正后，`supervisor-api` 在真实 retrieval 路径上继续崩溃，根因是 document registry 当前行仍残留 legacy authz payload：
   `registry payload contains unsupported authorization projection keys: acl_groups, campus_scope`

因此当前失败不是“评测框架坏掉了”，也不是“模型质量直接退化了”，而是本地 data plane 与 canonical runtime query path 不一致。

## 2026-04-03 执行进展

本轮已确认并修复两个更深一层的离线阻塞点：

1. `local_rebuild.rebuild_local_data()` 在删除旧 derived artifacts 之前，会先枚举 scope 下的 registry rows 收集 `processed_object_keys`；legacy rows 会在 `_document_record_from_dict()` 处提前抛错。
2. `campusrag_ingestion_support.collect_import_document_stats()` 在真正写入新 import 结果前，也会先 `list_by_scope()` 预取 existing records；如果 scope 内仍有 legacy payload，provider replay rebuild 依旧会在导入阶段失败。

已落地的 repo 修复保持了 runtime canonical-only fail-fast，不把 legacy 兼容重新带回 query path：

- `registry` 新增离线辅助读取：
  - `list_processed_object_keys_by_scope`：直接从原始 payload 提取 `processed_object_keys`
  - `list_importable_scope_records_by_scope`：逐行跳过 legacy authz payload，只返回仍可作为导入对比基线的 canonical rows
- `local_rebuild` 现在优先使用原始 `processed_object_keys` 入口做 rebuild 前清理，不再要求 scope rows 先能完整反序列化
- `collect_import_document_stats` 现在优先使用 importable prefetch；若是 `scope_refresh` 主 scope 且 registry 只剩 legacy rows，也允许按空旧 scope 继续 full-scope replace

本轮已通过的回归验证：

- `uv run --all-packages python -m unittest tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild tests.ingestion.test_registry_models`

当前操作状态：

- `student_handbook` preview rebuild 已不再在 `unsupported authorization projection keys` 处秒退
- 它会继续进入 object store / Qdrant 外部 I/O 阶段；由于这轮执行中超过 5 分钟仍未收口，已手动停止，避免在 worktree 留下无限后台任务
- 因此 Wave 2 的“legacy parser fail-fast”阻塞已解除，但 preview rebuild / alias publish / live accept 仍未完成

## 2026-04-04 执行结果

### 已完成恢复

- `local_rebuild` 现已对 `provider_response_replay` 统一补齐 `source_pdf` 解析：
  - `rebuild_local_data()` 与 `replay_provider_response_rebuild()` 都会在 request 未显式传入 `source_pdf` 时，优先读取 raw asset registry 的 `source_filename`
  - `curriculum_plan` replay 不再默认回落到错误的 `curriculum-plan.pdf -> undated` provider key
- 在上述 recovery 基线之上，本轮又修复了 curriculum public document 错误继承 `visibility_scope=main` 的问题：
  - `configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json` 与 `split-manifest.candidate.v1.json` 已移除 public doc 上的 `visibility_scope: "main"`
  - `SplitManifestDocument.resolved_visibility_scope()` 现在对 public doc 返回 `None`，不再从 collection default scope 继承
  - curriculum budget evaluation fixtures 也同步切回 public/null scope，避免继续把 `main` 固化成评测真相
- 相关回归已补齐并通过：
  - `./.venv/bin/python -m unittest tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild`
  - `./.venv/bin/python -m unittest tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_registry_models tests.ingestion.test_rebuild_local_data_worker`
  - `./.venv/bin/python -m unittest tests.ingestion.test_split_manifest`
  - `./.venv/bin/python -m unittest tests.ingestion.test_curriculum_budget_evaluation`
  - `./.venv/bin/python -m unittest tests.ingestion.test_rebuild_local_data`
  - `./.venv/bin/python -m unittest tests.ingestion.test_campusrag_ingestion_support`
  - `./.venv/bin/python -m unittest tests.ingestion.test_process_raw_ingestion_job`
- `curriculum_plan` preview rebuild 已成功完成：
  - artifact: `.tmp/rebuilds/local-live-eval-recovery-20260404T010216/`
  - trace 已确认 `replay.load_source_artifacts` 使用 `curriculum-plan-2022.pdf`
  - preview report `failed_count=0`
- 针对 `visibility_scope` 修复又重新执行了一轮 release-managed preview / publish：
  - `raw_version_id=sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67`
  - preview report: `var/import-reports/replay-provider-response-rebuild-2026-04-04T043032.709153_plus_0000.json`
  - preview summary: `success_count=91`, `failed_count=0`
  - publish report: `var/import-reports/replay-provider-response-rebuild-2026-04-04T044027.720446_plus_0000.json`
  - publish summary: `success_count=69`, `skipped_count=22`, `failed_count=0`
- 当前 worktree 额外补上了 `app-api` rerun 稳定性修复：
  - Worker runtime 现按 `Env` 复用，不再在 repeated eval 请求中反复重建 app assembly
  - chat/runtime stores 现按 service assembly 复用单个 runtime DB handle
  - targeted verification 已通过：
    - `pnpm --filter app-api test:node -- test/chat.store.test.ts test/runtime-command.store.test.ts test/worker-runtime-cache.test.ts test/worker.test.ts`
- publish alias 已完成：
  - handbook publish artifact: `.tmp/rebuilds/local-live-eval-recovery-publish-handbook-20260404T011422/`
  - curriculum publish artifact: `.tmp/rebuilds/local-live-eval-recovery-publish-curriculum-20260404T012037/`
- publish 后 alias / points count：
  - `student_handbook -> student_handbook__r20260403_171551 (509)`
  - `contact_directory -> contact_directory__r20260403_171551 (6)`
  - `service_catalog -> service_catalog__r20260403_171551 (1)`
  - `curriculum_plan -> curriculum_plan__r20260404_044030 (1728)`
  - `course_facts -> course_facts__r20260404_044030 (16)`
  - `program_family_facts -> program_family_facts__r20260404_044030 (6)`
- document registry current rows 已恢复 canonical-only：
  - `('curriculum', 'curriculum_plan', legacy_current_rows=0, current_rows=69)`
  - `('regulations', 'student_handbook', legacy_current_rows=0, current_rows=46)`
- curriculum public doc payload 已确认不再携带 `visibility_scope`：
  - `select record->>'visibility_scope', count(*) from ... where corpus='curriculum' and collection='curriculum_plan' group by ...`
  - result: `[(None, 69)]`

### 本轮 runtime 结果

- repo-local `supervisor-api` 已按 `trusted-worker + 8081` 启动，沿用本地 `app-api` `127.0.0.1:8787`
- handbook smoke 已恢复为正常回答链路：
  - prompt: `中央民族大学本科学生国家奖学金评审办法`
  - result: `status_code=200`, `answer_kind=answer`, `supervisor_status=completed`
- curriculum smoke 已不再 crash，但代表性自然问法仍返回 `no_answer`：
  - prompt: `民族学本科人才培养方案`
  - prompt: `民族学本科人才培养方案里大二下有什么课`
  - result: `status_code=200`, `answer_kind=no_answer`, `supervisor_status=no_answer`
- curriculum internal eval smoke 已确认本轮修复的是权限误投影，而不是把 deny 变成兼容层：
  - campus_member 与 student 两条 `POST /api/internal/evals/chat/requests` 都返回 `status_code=200`
  - `supervisor.observability.aclDecision=allowed`
  - `supervisor.observability.failClosed=false`
  - 响应中不再出现 `restricted_access_denied`
  - 当前剩余问题是 retrieval / answer quality 仍然不足，表现为 `no_answer`

### 本轮 live accept 结论

- `curriculum-plan-live-gate-accept-20260404T045259Z/` 不能作为最终 truth：
  - 本地 `wrangler dev` 中途 hot reload，`app-api` 返回 `503 Service Unavailable`
  - eval 侧错误为 `AppApiEvalClientError: Your worker restarted mid-request`
- curriculum 首个有效 post-recovery live accept 已完整收口：
  - artifact: `.tmp/evals/curriculum-plan-live-gate-accept-20260404T045929Z/`
  - `final-summary.json`:
    - `deterministic_verdict=fail`
    - `supplemental_verdict=warn`
    - `final_overall_verdict=fail`
  - 三轮 deterministic run 完全稳定复现：
    - `run_pass_counts=[8,8,8]`
    - `run_failed_counts=[11,11,11]`
  - 与旧 artifact `.tmp/evals/curriculum-plan-live-gate-accept-20260404T013037/` 相比，稳定通过数已从 `5/19` 提升到 `8/19`
  - 当前失败已收敛为真实质量缺口，不再包含 `restricted_access_denied` 这类 authz false deny：
    - `curriculum-release-gate-academic-years`
    - `curriculum-release-gate-course-family-membership`
    - `curriculum-release-gate-course-family-audience-short-alias`
    - `curriculum-release-gate-course-single-schedule`
    - `curriculum-release-gate-course-single-schedule-alias-variant`
    - `curriculum-release-gate-program-family-membership`
    - `curriculum-release-gate-program-family-experimental-membership`
    - `curriculum-release-gate-program-family-strong-base-membership-full-alias`
    - `curriculum-release-gate-program-family-name-pattern-experimental-membership`
    - `curriculum-release-gate-program-follow-up-session-replay`
    - `curriculum-release-gate-strong-base-follow-up-session-replay`
  - supplemental gate 仍是稳定 soft warning：
    - `ragas.faithfulness mean_average_score=0.22213910816851992`
    - `ragas.answer_relevancy mean_average_score=0.24002871915163038`
    - `ragas.context_precision mean_average_score=0.2857142857142857`
    - `ragas.context_recall mean_average_score=0.2857142857142857`
  - 当前结论已经从“runtime crash / ACL false deny 污染”升级为“curriculum 产品质量 gate 真失败”
- 在上述 recovery 基线上，curriculum answer path 又额外落地了 semester row filtering 修复：
  - `packages/rag-specialist/src/campus_rag_specialist/agent.py` 现会在 `curriculum_plan` 表格答案里按学期逐行过滤，而不是把同一 source 内其他学期的课程一并带出
  - 同时覆盖两类表：
    - `修读学期` / `开设学期` 这类单列学期表
    - `1 | 2 | 3 | 4` 这类 numeric semester header 表
  - targeted verification 已通过：
    - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist.CurriculumQueryPlanningTest`
    - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_curriculum_query_resolution`
- semester row filtering 修复后的 curriculum 当时最新有效 live accept 为：
  - artifact: `.tmp/evals/curriculum-plan-live-gate-accept-20260404T0950Z/`
  - `final-summary.json`:
    - `deterministic_verdict=fail`
    - `supplemental_verdict=warn`
    - `final_overall_verdict=fail`
  - 三轮 deterministic run 再次完全稳定复现：
    - `run_pass_counts=[17,17,17]`
    - `run_failed_counts=[2,2,2]`
  - 与 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T045929Z/` 相比，稳定通过数已从 `8/19` 提升到 `17/19`
  - 当前 deterministic failure 已收敛到 2 个 follow-up answer completeness case：
    - `curriculum-release-gate-program-follow-up-session-replay`
    - `curriculum-release-gate-strong-base-follow-up-session-replay`
  - 这轮已经不存在 status / retrieval / trace 维度失败：
    - `status=19/19`
    - `retrieval=19/19`
    - `trace=19/19`
    - `answer=17/19`
  - 直接核查当前 `curriculum_plan` alias 的 Qdrant point 后，两个失败的性质已经可以区分：
    - 法学民族班 case 命中的 supporting chunk 仍是 `chunk-0016`，其中确有 `侵权责任法 / 公司法 / 翻译学导论 / 中国少数民族文字学`，但没有 `习近平法治思想概论`，也没有 `国际公法`
    - 同一 doc 内 `习近平法治思想概论` 实际存在于 `chunk-0012 / chunk-0004 / chunk-0013`，且 `chunk-0013` 明确是 `修读学期=1`
    - 因此法学 follow-up case 当前更像 benchmark/qrels 与现行 alias truth 脱钩，而不是模型把已存在的四学期课程漏答
    - 历史强基 case 命中的 supporting chunk 仍是 `chunk-0010`，其中有 `大学英语(四)` 与 `中华民族共同体概论` 等第四学期课程
    - 但 `中国史学史` 实际存在于同一 doc 的 `chunk-0014`，且该 chunk 标注的 `修读学期=5`；`史学理论专题` 在当前 alias 中不存在
    - 因此历史 follow-up case 仍保留一处真实 ranking / answer-selection gap：系统没有把已存在的 `中国史学史` chunk 提升为 supporting source，但 benchmark 对 `史学理论专题` 的期望同样已经与当前 alias truth 脱钩
  - 在 `0950Z` 时点的结论是：repo-local curriculum live accept 仍然 fail，但 fail 的性质已经从“多维质量不足”收敛到“1 个 stale benchmark/qrel + 1 个 ranking/selection gap + 2 个 case 都带有部分 expected fact 与当前 alias 不一致”
- 在上述 `0950Z` curriculum artifact 之后，repo-local `app-api` 还额外完成了一轮 runtime stability closeout：
  - `apps/app-api/src/db/runtime.ts` 现在在 `development` 下不再复用 worker / runtime DB 缓存，`readyz` probe 使用隔离的短生命周期 pool，不再污染请求路径连接
  - `apps/app-api/src/modules/auth/auth.ts` 的 auth readiness 只探活 DB，不再在 `/readyz` 上提前构建 Better Auth runtime
  - `apps/app-api/src/app.ts` / `apps/app-api/src/index.ts` 不再让 synthetic `/api/internal/evals/chat/requests` 调度 request projection drain
  - `apps/app-api/src/modules/telemetry/axiom.ts` 为 Axiom ingest 增加了 bounded fail-open timeout，避免 sink 挂死请求
  - focused verification 已通过：
    - `pnpm --dir apps/app-api test:node -- test/auth-and-db.test.ts test/chat-requests.route.test.ts test/telemetry.axiom.test.ts`
    - `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts test/worker-runtime-cache.test.ts`
    - `pnpm --dir apps/app-api typecheck`
  - repo-local live smoke 也已复核：
    - 对 `POST http://127.0.0.1:8787/api/internal/evals/chat/requests` 连续发送 3 次 `法学民族实验班培养方案里第四学期有什么课`，三次均返回 `HTTP 200`
  - 在这条稳定后的本地链路上，fresh full rerun `.tmp/evals/curriculum-plan-live-gate-accept-20260404T130027Z/` 曾启动，但最终被 `AppApiEvalClientError: app_api_eval_request_failed: Your worker restarted mid-request. Please try sending the request again.` 污染
  - 因此 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T130027Z/` 只能作为新的 runtime incident record；它后续已被无重启 rerun `.tmp/evals/curriculum-plan-live-gate-accept-20260404T184401Z/` 覆盖，不再代表当前 latest completed full artifact
- 在上述 runtime closeout 之后，本 worktree 又完成了一轮 follow-up closeout 核查：
  - law follow-up 的 repo code/tests 真相已经与当前 alias 对齐：
    - `packages/evals/src/campus_evals/scenarios.py` 与 `tests/evals/test_curriculum_live_benchmark.py` 当前都将 `curriculum-release-gate-program-follow-up-session-replay` 的 required facts 固定为 `中国少数民族文字学 / 侵权责任法`
    - `tests/evals/test_golden_cases.py` 现额外显式锁定了 law/history 两个 follow-up case 的 expected doc id 与 required facts，避免后续再把历史 artifact 里的坏 truth 回写进 benchmark
    - 需要纠正的旧描述并不是 `国际公法` 仍在 repo code 里生效，而是 `0950Z` 历史 artifact 里仍残留了对 `习近平法治思想概论` 的陈旧 completeness 期望
  - history strong-base follow-up 的当前代码路径已完成 repo-local 直连复核：
    - 直接调用 retrieval backend 查询 `历史学强基计划培养方案里第四学期有什么课`，当前 top-5 已返回 `chunk-0014 / chunk-0018 / chunk-0010 / chunk-0013 / chunk-0022`，其中 `chunk-0014` 位于 truncation 之前
    - 直接调用 `delegate_to_rag_agent` 时，answer 已同时保留 `chunk-0010 + chunk-0014`，并包含 `大学英语(四)` 与 `中国近代边疆民族史料研读`
    - 因此 history follow-up 在代码侧已不再应被当作当前 worktree 的开放缺口；当时剩余待办只是在无重启窗口里重跑 full live accept
- 在上述 follow-up closeout 基线上，fresh no-restart full rerun 已完成并形成新的 latest completed full artifact：
  - artifact: `.tmp/evals/curriculum-plan-live-gate-accept-20260404T184401Z/`
  - `final-summary.json`:
    - `deterministic_verdict=fail`
    - `supplemental_verdict=warn`
    - `final_overall_verdict=fail`
    - `repair_run_dir=null`
  - 三轮 deterministic run 现稳定收敛为：
    - `run_pass_counts=[18,18,18]`
    - `run_failed_counts=[1,1,1]`
    - `stable_across_runs=true`
  - 与 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T0950Z/` 相比，稳定通过数已从 `17/19` 提升到 `18/19`
  - 当前 deterministic failure 已收敛到单个 case：
    - `curriculum-release-gate-program-follow-up-session-replay`
  - 三轮 failure reason 完全一致：
    - `answer=missing required fact=中国少数民族文字学`
    - `status / retrieval / trace` 全部为 `ok`
  - 这轮已经明确证明 history strong-base follow-up 不再是 live artifact failure：
    - `curriculum-release-gate-strong-base-follow-up-session-replay` 在三轮 deterministic run 全部通过
  - 该 law follow-up failure 的性质也已经进一步收敛：
    - supporting sources 仍来自正确 doc `curriculum:法学（民族实验班）本科人才培养方案`
    - supporting chunks 稳定为 `chunk-0016 + chunk-0015`
    - 因此当前剩余问题是 correct-doc retrieval 之后的 answer completeness gap，而不是 runtime incident、错误 doc 命中，或 history case 那样的 residual ranking gap
  - supplemental gate 仍是稳定 soft warning：
    - `ragas.faithfulness mean_average_score=0.7839435774309723`
    - `ragas.answer_relevancy mean_average_score=0.7982046080163911`
    - `ragas.context_precision mean_average_score=0.7142857142571429`
    - `ragas.context_recall mean_average_score=0.7142857142857143`
  - 当时的最新结论是：
    - `.tmp/evals/curriculum-plan-live-gate-accept-20260404T184401Z/` 在该时间点取代 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T0950Z/`，成为 then-current completed repo-local curriculum artifact
    - curriculum live accept 仍然 fail，但已经不再是“双 follow-up gap”；当前只剩 law follow-up answer completeness 单点缺口
    - 这次 rerun 没有出现 `Your worker restarted mid-request`，因此它是有效的产品质量结论，而不是新的 runtime incident
- 在上述 `184401Z` artifact 基线之上，本 worktree 当前又完成了一轮 repo-head answer-path closeout：
  - 针对唯一剩余的 law follow-up completeness gap，`packages/rag-specialist/src/campus_rag_specialist/agent.py` 现已额外落地 semester course-list 定点修复：
    - semester-scoped `curriculum_plan` table rows 不再被 `_rank_source_statements()` 截到前三行
    - direct answer path 会直接从命中的 semester rows / source snippet 提取 `课程名称` 列，而不是继续把整行表格文本原样拼进答案
    - 因此 `chunk-0015 + chunk-0016` 的第四学期课程现在会稳定包含 `合同法 / 人格权法 / 物权法 / 侵权责任法 / 公司法 / 翻译学导论 / 中国少数民族文字学`
  - 同步新增了 answer-path 回归测试，直接锁定旧失败模式：
    - `tests/specialist/test_rag_specialist.py::CurriculumQueryPlanningTest.test_curriculum_semester_answer_lists_all_semester_courses_without_table_row_truncation`
  - fresh targeted verification 已通过：
    - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
    - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_curriculum_live_benchmark tests.evals.test_golden_cases`
  - 这一步先关闭了 repo-head code gap；其后又完成了 fresh rerun，新的 artifact truth 见下一个条目
- 在上述 repo-head answer-path closeout 之后，又完成了一轮 fresh full curriculum live accept：
  - artifact: `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z/`
  - 本轮为真正的 full accept，而不是 rebuild/index 发布：
    - 沿用当前 `curriculum_plan` alias
    - 不重新 embedding
    - 只重跑 `app-api -> supervisor-api -> retrieval -> rag-specialist` live benchmark
  - 本地运行前额外补齐了 `app-api` dev 前提：
    - `apps/app-api/.env` 中只有 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
    - 本轮本地 shell 显式将 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH` 指向同一条连接串，满足 local Hyperdrive binding 校验
  - `final-summary.json`:
    - `deterministic_verdict=pass`
    - `supplemental_verdict=warn`
    - `final_overall_verdict=warn`
    - `repair_run_dir=null`
  - 三轮 deterministic run 现稳定收敛为：
    - `run_pass_counts=[19,19,19]`
    - `run_failed_counts=[0,0,0]`
    - `stable_across_runs=true`
  - 这轮已经明确证明 law/history 两个 follow-up replay case 都在 live artifact 中通过：
    - `curriculum-release-gate-program-follow-up-session-replay` 在 `run-01`、`run-02`、`run-03` 全部 `passed=true`
    - `curriculum-release-gate-strong-base-follow-up-session-replay` 在 `run-01`、`run-02`、`run-03` 全部 `passed=true`
  - 因此当时的 deterministic curriculum release gate 已关闭：
    - `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z/` 在该时间点取代 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T184401Z/`，成为 then-current completed repo-local curriculum artifact
    - law follow-up answer completeness 不再是 live gap
    - repair stage 仍被跳过，说明当前 rerun 没有 transient deterministic target 需要修补
  - 当时 remaining issue 已收敛为 supplemental soft warn：
    - `ragas.faithfulness mean_average_score=0.7946184029167221`
    - `ragas.answer_relevancy mean_average_score=0.7987128849797461`
    - `ragas.context_precision mean_average_score=0.7142857142571429`
    - `ragas.context_recall mean_average_score=0.7142857142857143`
    - 因此当前 verdict 不是 `fail`，而是 deterministic release gate pass + overall soft warn
- 2026-04-13 Phase 1000 closeout 之后，curriculum 的 current artifact truth 已进一步更新为：
  - artifact: `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/`
  - 该轮在新的 `program_semester_facts` publish release 与 trace split closeout 之后执行
  - `run-01` / `run-02` / `run-03` 全部 `19/19 passed`
  - 当前 `19` 的组成固定为 `16` 条 `curriculum release_gate` case 加 `3` 条 deterministic `curriculum error_gate` case；repo 中曾短暂出现过的重复 release-gate 定义属于 historical eval drift，不代表 accepted curriculum truth
  - `final-summary.json`:
    - `deterministic_verdict=pass`
    - `supplemental_verdict=pass`
    - `final_overall_verdict=pass`
    - `repair_run_dir=null`
  - 因此 `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/` 现已取代 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z/` 成为 current latest completed repo-local curriculum artifact
- handbook live accept 现已完整收口，并形成新的 clean pass baseline：
  - artifact: `.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z/`
  - `final-summary.json`:
    - `deterministic_verdict=pass`
    - `supplemental_verdict=pass`
    - `final_overall_verdict=pass`
    - `repair_run_dir=null`
  - 三轮 deterministic run 结果：
    - `run_pass_counts=[11,11,11]`
    - `run_failed_counts=[0,0,0]`
  - supplemental gate 已恢复为 clean pass：
    - `ragas.faithfulness mean_average_score=0.9151635401635402`
    - `ragas.answer_relevancy mean_average_score=0.8780248495851825`
    - `ragas.context_precision mean_average_score=1.0`
    - `ragas.context_recall mean_average_score=1.0`
    - `judge.answer_correctness_rubric mean_average_score=0.921904761904762`
    - `judge.refusal_quality mean_average_score=0.9491666666666666`
  - 因此 handbook 当前已从“rerun crash recovery”进一步收口为“新的 clean pass release baseline”

## 目标

恢复一条有效的 repo-local live accept 路径，使 handbook / curriculum 的 accept 结果重新可用于产品判断。

本轮完成时，至少满足：

1. repo-local `app-api -> supervisor-api` live eval 路径以 `trusted-worker` 模式稳定联通。
2. `curriculum_plan` 与 `student_handbook` 的 current serving registry rows 不再含 `acl_groups` / `campus_scope` / `acl_level`。
3. release-managed rebuild 重新生成 canonical authz projection 的 registry / chunk / index truth。
4. handbook / curriculum representative smoke 不再返回 `internal_error` 或 `supervisor_unavailable`。
5. 新的一轮 live accept 不再被 runtime crash 污染，才允许重新讨论 deterministic / supplemental gate 的产品结论。

## 不可退让约束

1. 不允许为了让本地 accept 通过，重新把 runtime query path 改回读取 legacy ACL carrier。
2. legacy 兼容只允许留在离线 rebuild / migration 入口；不允许重新进入 `supervisor-api`、`retrieval-core`、`rag-specialist` 的产品路径。
3. alias publish 之前必须先做 preview rebuild；不允许直接手改 alias 指针跳过验证。
4. 若 preview rebuild 后 current rows 仍含 legacy key，应先停下查 data-plane truth，不允许直接继续跑 accept。

## 执行顺序

### Wave 0：本地 runtime 启动方式纠正

目标：

- 确保本地 eval ingress 使用的不是错误的 `bearer` 本地默认值

动作：

- root `.env` 保持本地 eval ingress 参数：
  - `APP_API_BASE_URL=http://127.0.0.1:8787`
  - `APP_API_INTERNAL_SHARED_SECRET=<same as apps/app-api/.dev.vars>`
  - `APP_API_EVAL_USER_EMAIL=<local eval user>`
- 本地 `supervisor-api` 必须按下面方式启动，而不是直接吃 root `.env` 默认 `bearer`：

```bash
set -a && source apps/app-api/.dev.vars && set +a && \
API_AUTH_MODE=trusted-worker \
API_WORKER_SHARED_SECRET="$SUPERVISOR_API_SHARED_SECRET" \
CAMPUS_AGENT_HTTP_HOST=127.0.0.1 \
CAMPUS_AGENT_HTTP_PORT=8081 \
uv run --all-packages campus-supervisor-api-dev
```

- `app-api` 保持：

```bash
pnpm --dir apps/app-api dev -- --ip 127.0.0.1 --port 8787
```

完成定义：

- `app-api` 不再因为 bridge auth mismatch 返回顶层 `internal_error`
- 本地 supervisor bridge 语义与 Worker runtime seam 一致

### Wave 1：冻结当前脏数据范围

目标：

- 在重建前确认用于 replay 的 `raw_version_id`，并确认 legacy payload 仍落在哪些 current rows

动作：

- 查询 raw asset registry，锁定本轮 handbook / curriculum 的 `raw_version_id`
- 查询 document registry current rows，确认 legacy authz key 只作为待修复数据问题被记录，而不是继续被 runtime 消费

推荐检查：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python - <<'PY'
import os, psycopg

raw_dsn = os.environ["RAW_ASSET_REGISTRY_DATABASE_URL"]
doc_dsn = os.environ["DOCUMENT_REGISTRY_DATABASE_URL"]

with psycopg.connect(raw_dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            select corpus, collection,
                   record->>'raw_asset_id' as raw_asset_id,
                   record->>'raw_version_id' as raw_version_id,
                   record->>'ingestion_timestamp' as ingestion_timestamp
            from ingestion_registry.raw_asset_registry_records
            where (corpus, collection) in (
              ('curriculum', 'curriculum_plan'),
              ('regulations', 'student_handbook')
            )
            order by corpus, collection, ingestion_timestamp desc
            """
        )
        print(cur.fetchall())

with psycopg.connect(doc_dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            select corpus, collection, count(*)
            from ingestion_registry.document_registry_records
            where (corpus, collection) in (
              ('curriculum', 'curriculum_plan'),
              ('regulations', 'student_handbook')
            )
              and (record->>'is_current')::boolean = true
              and (
                (record ? 'acl_groups')
                or (record ? 'campus_scope')
                or (record ? 'acl_level')
              )
            group by corpus, collection
            order by corpus, collection
            """
        )
        print(cur.fetchall())
PY
```

完成定义：

- 两个 collection 的 rebuild 输入已锁定
- 当前 serving rows 的 legacy payload 污染范围可重复确认

### Wave 2：preview canonical rebuild，不切 alias

目标：

- 先生成新的 canonical rebuild 结果，不直接影响 serving alias

动作：

- handbook 与 curriculum 都走 release-managed replay rebuild
- 都带 `--reset-index`
- 都先使用 `--no-publish-alias`

命令模板：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <curriculum_raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --reset-index \
  --no-publish-alias
```

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus regulations \
  --collection student_handbook \
  --raw-version-id <handbook_raw_version_id> \
  --source-pdf 学生手册_2018.pdf \
  --reset-index \
  --no-publish-alias
```

preview 后必须复查：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python - <<'PY'
import os, psycopg

doc_dsn = os.environ["DOCUMENT_REGISTRY_DATABASE_URL"]
with psycopg.connect(doc_dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            select corpus, collection, count(*)
            from ingestion_registry.document_registry_records
            where (corpus, collection) in (
              ('curriculum', 'curriculum_plan'),
              ('regulations', 'student_handbook')
            )
              and (record->>'is_current')::boolean = true
              and (
                (record ? 'acl_groups')
                or (record ? 'campus_scope')
                or (record ? 'acl_level')
              )
            group by corpus, collection
            order by corpus, collection
            """
        )
        print(cur.fetchall())
PY
```

完成定义：

- current serving rows 已切回 canonical-only authz projection
- 若仍残留 legacy current rows，本轮停止，不继续 alias publish

### Wave 3：publish alias，并做最小 smoke

目标：

- 在确认 preview rebuild 没问题后，再让 serving alias 指向新的 physical collection

动作：

- handbook / curriculum 分别执行正式 publish
- 不手动改 alias；仍通过 repo 自带 release shell 完成

命令模板：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <curriculum_raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --publish-alias
```

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus regulations \
  --collection student_handbook \
  --raw-version-id <handbook_raw_version_id> \
  --source-pdf 学生手册_2018.pdf \
  --publish-alias
```

然后重启 Wave 0 的本地 runtime，并做两条 smoke：

- `民族学本科人才培养方案`
- `中央民族大学本科学生国家奖学金评审办法`

通过标准：

- `/api/internal/evals/chat/requests` 返回 `200`
- `answer.result.kind` 不再是 `error`
- `supervisor.status` 不再是 `error`

完成定义：

- 本地 serving alias 已重新回到 canonical rebuild truth
- representative handbook / curriculum live query 可以稳定穿过 supervisor / retrieval path

### Wave 4：重跑 live accept，收口 artifact

目标：

- 在 runtime 不再 crash 的前提下，重新生成可消费的 live benchmark truth

命令模板：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept \
  --reruns 3 \
  --verbose \
  --log-jsonl .tmp/evals/curriculum-runtime-events-<timestamp>.jsonl \
  --output-dir .tmp/evals/curriculum-plan-live-gate-accept-<timestamp>
```

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.handbook_live_benchmark accept \
  --reruns 3 \
  --verbose \
  --log-jsonl .tmp/evals/student-handbook-runtime-events-<timestamp>.jsonl \
  --output-dir .tmp/evals/student-handbook-formal-benchmark-accept-<timestamp>
```

这轮必须至少记录：

- final summary
- gate report
- runtime events jsonl
- preview / publish rebuild report
- smoke 请求样本与 request / trace id

完成定义：

- accept 结果不再由 runtime crash 污染
- deterministic / supplemental verdict 才允许重新被解释成产品质量信号

## 验证门槛

本轮至少要拿到下面四类证据：

1. current serving rows canonical-only 的 SQL 证据
2. preview rebuild 与 publish rebuild 的 report artifact
3. handbook / curriculum 代表问题 smoke 通过
4. 两套 live accept 的 final summary 与 gate report

若后续需要补代码修复，额外至少补：

- `tests.ingestion.test_registry_models`
- `tests.ingestion.test_provider_result_replay_rebuild`
- `tests.api.test_supervisor_api`
- `tests.evals.test_curriculum_live_benchmark`
- `tests.evals.test_handbook_live_benchmark`

## 停止条件

出现下面任一情况时，应停止继续 publish 或 accept，先回到 data-plane 排查：

- preview rebuild 后 current rows 仍有 `acl_groups` / `campus_scope` / `acl_level`
- `supervisor-api` 仍抛出 `unsupported authorization projection keys`
- smoke 仍返回 `status=error`

出现下面情况时，应单独分流为环境问题，而不是继续归因给 registry：

- provider DNS / timeout / credential 错误
- `app-api` local DB drift 或 Hyperdrive local connection 异常
- local worker observability sink 造成的非主链路网络噪声

## 当前建议

先执行 Wave 1 与 Wave 2。

原因：

- 当前 root cause 已经明确落在 local data-plane truth，不需要先改代码
- canonical rebuild 是和现有 ADR / sunset plan 一致的修复方向
- 只有 preview rebuild 先证明 current rows 已 canonical-only，后续 publish alias 与 accept 才有意义
