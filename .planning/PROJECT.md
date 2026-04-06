# Campus Agent

## What This Is

`campus-agent` 是一个面向学生、教职工和潜在考生的 multi-agent 校园问答助理仓库，长期形态是以 `supervisor` 作为唯一入口、`specialist agent` 作为能力边界的 supervisor-led orchestration system。当前 v1 的重点不是一次性做全量校园知识问答，而是在新架构下把 `supervisor -> rag-specialist -> retrieval` 主路径稳定成立，并让 serving surface 由 runtime profile 显式控制。当前 query-enabled surface 是 `student_handbook` 与 `curriculum_plan`；`campus_services` 仍保持 offline preparation。与此同时，若存在长期稳定、可复用、非 handbook-RAG 的能力边界，例如官网探活 / 外部站点可达性核验，也允许以独立 specialist 的形式作为当前里程碑中的显式 inserted phase 落地，而不是被降级成 supervisor 内联 tool。旧仓库 `../campusRAG` 只作为迁移参考，不再作为继续扩展的主实现。

## Current Truth

- 当前 serving surface 由 collection runtime profile 控制，不再由早期 `phase-1` 路由文案单独定义
- 当前 query-enabled scope 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `campus_services/*` 仍为 `offline_preparation`
- 当前分支模型固定为：`develop` 承担长期集成，`main` 承担稳定发布，`main` 上的改动只通过 PR 进入
- retrieval 读取 serving alias；离线索引发布写入 versioned physical collection，并以 release manifest 保留追溯信息
- shared `apps/app-api` Worker backend、`apps/public-chat-web`、`apps/protected-panel-web` 已在当前工作树落地
- panel `Requests` 已接上 `apps/app-api` 的 runtime-owned request projection APIs；不得绕回 audit log、telemetry sink、consumer chat tables 或 `apps/supervisor-api`
- `official_web` control plane 已在 shared `apps/app-api` 落地，collector admission、crawl-run ledger、operator query 与 ingestion handoff 继续收口在同一 Worker backend；`apps/ingestion-worker` 继续只是 offline executor
- canonical app identity、profile memory 与 session truth 归属 shared `app-api`；execution engine 只消费 typed projection
- personalization 可以利用 verified identity / profile memory / session summary，但 memory 不得授予权限或绕过 retrieval ACL
- 04.7 `public-consumer-chat` 现仅作为历史实现参考，不再覆盖 forward topology truth
- 当前 merged truth 已按 `ContextProjection` / `SupervisorResponse` / eval supervisor seam 收口；后续改动不得回退到旧 `snapshot`
- worktree-local `v1.0` evidence chain 已在 Phase 9 收口；official-web 当前不再缺 release-lifecycle plumbing。Phase 10.3 完成后的 final replay `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v9` 现已进一步滚入本地 import/release candidate：unpublished release `r20260404_184508` 已通过 `document_count=21 / point_count=109 / validation_status=passed`、retrieval qrels `9/9` 与 deterministic live gate `13/13`；后续如需继续推进，应单独决定是否 publish alias，而不是重新争论 fixed-scope clean/chunking
- `student_handbook` 当前最新 release-truth artifact 已更新为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z`；deterministic / supplemental / final 全 `pass`
- `curriculum_plan` 当前 latest completed live artifact 为 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`；deterministic reruns 已稳定为 `19/19` 全通过，剩余问题只在 supplemental soft-warn
- `official_web/muc_public_pages` 当前 worktree-local current truth 已显式收口为 `21` 条 promotable 文档：`11` 条 `release_gate_required`、`2` 条 `retain_inventory_only`、`8` 条 `future_fresh_news_surface`；只有 `release_gate_required` 子集进入当前 answer-quality gate
- `official_web/muc_public_pages` 已在 2026-04-02 为较早一轮 imported dataset 闭环 registry-backed release + alias lifecycle，但当前 published alias 仍停留在 1 条 listing-heavy `generic_content_page` 记录；collection 继续保持 `offline_preparation`，并且只应被视为 mixed 过渡 collection，而不是长期最终 corpus split
- Phase 10.4 已把 `official_web` corpus split 的第一条执行链路落地：repo 现在有 `projection-routing.json` truth，stable-reference bootstrap 子集可从 replay 直接路由到 `official_web/stable_reference`，并且 mixed replay output 可以按请求 scope 单独导入
- Phase 10.5 已把 `official_web/stable_reference` 的第一条真实 replay/import/release 证据落盘；2026-04-05 又通过 `campus_ingestion_worker.scope_alias` 把 `official_web_stable_reference` 发布到 `official_web_stable_reference__r20260404_204033`，并确认 alias-path retrieval/live gate 继续通过
- retrieval / specialist / eval 当前已不再把 stable-reference-like official-web 语义绑死在 `muc_public_pages`；同一套规则现在同时适用于 mixed bridge 与 `stable_reference`
- `official_web/stable_reference` 当前已有 repo-tracked split manifest、retrieval qrels 与 deterministic live-gate baseline；2026-04-05 本地实跑已确认 retrieval `hit@1=1.0 / recall@5=1.0 / forbidden_hit_rate=0.0`，deterministic live gate `11/11 pass`
- `official_web/muc_public_pages` 的旧 serving alias 已在 2026-04-05 主动撤下；mixed bridge 继续保留为 replay/QC/regression truth，但不再维持一个误导性的 published alias
- `official_web/fresh_news` 当前也已补齐 repo-tracked split manifest、retrieval qrels 与 deterministic live-gate seed baseline；2026-04-05 本地 `8` 文档 seed import/release 生成 `official_web_fresh_news__r20260404_222909`，retrieval `8/8 hit@1`、live gate `8/8 pass`，但 runtime truth 仍保持 `offline_preparation`
- 早期 roadmap / phase 文档主要承担历史排期与讨论存档，不应覆盖这里的当前 truth

## Core Value

先把新的 supervisor-led multi-agent 架构站稳，并用 runtime-profile-driven serving surface 证明这条架构能可靠承接高频校园问答。

## Requirements

### Validated

- ✓ 仓库已经建立 supervisor-led 的长期架构边界与 phase-1 约束文档，明确 `apps/` 与 `packages/` 的职责划分 — existing
- ✓ 已存在 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core` 的主链路骨架与共享 contract 边界 — existing
- ✓ 已存在 ingestion/data plane 基础设施骨架，可支持 `student_handbook` 与 `curriculum_plan` 的 raw / processed / chunk 路径演进 — existing
- ✓ 已完成 `student_handbook` 的 canonical raw onboarding、稳定逻辑文档 identity/version 规则与 machine-checkable duplicate/update import reporting — Validated in Phase 2
- ✓ 已完成 `student_handbook` 的 canonical processed artifact、chunk metadata 与 Qdrant/retrieval payload handoff 收口 — Validated in Phase 3
- ✓ 已将边界清晰的 `official-web` / `availability` specialist 纳入当前执行，以独立 contract、supervisor 显式路由与 allowlisted 官方站点探活能力完成最小闭环 — Validated in Phase 03.1
- ✓ 已完成 `student_handbook` 的 `rag-specialist` answer path 收口，包括 grounded answer、chunk-level citation、`needs_clarification`、`no_answer` 与 `error` 语义 — Validated in Phase 4
- ✓ 已完成 `student_handbook` retrieval baseline 从 dense-only bootstrap 收口为 `dense + sparse hybrid + RRF + registry-backed evidence`，并通过 live handbook fixture 与 repo tests 验证 — Validated by 2026-03-27 live + automated verification
- ✓ 已完成 `supervisor -> specialist` 查询入口、typed actor propagation 与 durable audit logging 的 Phase 5 收口 — Validated in Phase 5
- ✓ 已完成 Cloudflare public-entry Worker runtime shell、trusted-origin forwarding 与 `apps/supervisor-api` trusted-worker origin admission — Validated in Phase 04.6
- ✓ 已完成 `public-consumer-chat` 的 04.7 app boundary / frontend host / auth-and-storage closeout，并已把实现与文档基线合入 `main`；该实现现作为历史参考而非 forward backend truth — Validated in Phase 04.7
- ✓ 已完成 shared `apps/app-api` Worker foundation、request projection API 与 `public-chat-web` / `protected-panel-web` 接线收口 — Validated on 2026-03-29
- ✓ 已完成 `student_handbook` 主链路的基础 eval / smoke / release-gate 验证，包含 live qrels benchmark、workflow/status 样本与 handbook collection schema 快照 — Validated in Phase 7
- ✓ 已完成 repo-head `student_handbook` live acceptance rerun，`2026-03-31 210128` 正式 artifact 已确认 expanded release-gate、`procedure_directness` 与所有 supplemental soft gate 全量通过 — Validated on 2026-03-31
- ✓ 已完成 `official_web -> app-api` control-plane ownership、contract、lifecycle、schema 与实施基线文档冻结 — Validated on 2026-03-29
- ✓ 已完成 `official_web -> app-api` control-plane foundation 实现，包含 collector command/query APIs、outbox 驱动的 operator projections 与 ingestion handoff，以及 protected panel `Official Web` domain — Validated on 2026-03-29
- ✓ 已完成 `official_web` corpus split 第一阶段执行面：repo-tracked projection routing 已把首批 stable-reference 页面从 `muc_public_pages` bridge 分流到 `official_web/stable_reference`，且 mixed replay output 已支持 scope-specific import 而不放宽 single-scope refresh — Validated in Phase 10.4
- ✓ 已完成 `official_web/stable_reference` 的首条真实 release-evidence 与 serving-side cleanup：repo 已记录真实 `stable_reference` physical release，并让 retrieval / specialist / eval 辅助逻辑支持 split scope 与 mixed bridge 共存 — Validated in Phase 10.5

### Active

- [ ] 当前 repo 已进入 post-closeout follow-up 执行期。Wave A planning truth refresh 与 worktree hygiene 已于 2026-04-06 收口；Wave B 也已推进到真实 staging 闭环阶段：`app-api-staging` / `chat-staging` 已恢复可用，新的远端证据已落到 `.tmp/staging-smoke/20260406T032941-wave-b-closure/` 与 `.tmp/observability-smoke/20260406T032941-staging-wave-b/`。当前真正剩余的外部阻塞项已收窄为 panel Access smoke 身份与 Sentry sink-side lookup access，而不再是“staging 尚未存在”或“chat lane 未恢复”。
- [ ] 首个真实部署环境现已固定为 `staging@ayafeed.com` 的项目隔离一级子域方案：`apps/app-api=https://campus-api-staging.ayafeed.com`、`apps/public-chat-web=https://campus-chat-staging.ayafeed.com`、`apps/protected-panel-web=https://campus-panel-staging.ayafeed.com`。当前 Cloudflare tier 不再依赖 `*.rag.ayafeed.com` 这类深一级 staging custom domain 的 SSL 可用性；同时 `ayafeed.com` 是共享 zone，generic 一级子域（如 `api-staging.ayafeed.com`）已被其他 repo 占用，不能再作为本仓库 deploy truth。repo 文档、`wrangler.toml` 与 tests 已收敛到项目隔离命名，`app-api-staging` / `public-chat-web-staging` / `protected-panel-web-staging` 都已发布到新的 custom domains，且 `campus-panel-staging` 已由真实 Cloudflare Access 接管。当前真实远端状态已前进到：`campus-api-staging` / `campus-chat-staging` readiness 为 `200`，`campus-panel-staging` readiness 为 Cloudflare Access `302` 登录页，deploy-side `SENTRY_*` / `AXIOM_*` secret 已存在，Axiom query access 已通过独立 read token 闭环；剩余待收口的是 panel interactive smoke、Sentry sink-side verification，以及 repo 内 hostname migration debt
- [ ] curriculum deterministic release gate 已在 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z` 关闭；后续如果继续投入 curriculum 线，目标应是 supplemental soft-warn 诊断与 truth 收口，而不是把 soft gate 再包装成 deterministic release blocker
- [ ] authenticated-notice historical closeout 已通过 real run `authenticated-notice-replay-20260406-024405` 收口；当前近端 follow-up 改为消费这次已完成 closeout，先执行 `campus_notices/internal_notice` 的 offline registry release、固定 release evidence，并保持 `restricted + offline_preparation` 不发布 query-serving alias；live portal scheduling 与 authenticated control-plane work 继续后置
- [ ] `official_web/fresh_news` / `official_web/news_archive` 的 runtime opening criteria 仍未冻结；这条工作继续留在独立 official-web worktree，不在当前 follow-up 分支直接推进 query-serving 开放
- [ ] `apps/public-chat-web` 的 `Chatbot-derived shell` replatform 已完成远端 hostname 对齐与 staging smoke 主链路验证：`app-api-staging` / `public-chat-web-staging` 已于 2026-04-06 重新部署到 `campus-api-staging.ayafeed.com` / `campus-chat-staging.ayafeed.com`，默认 `/chat` donor shell 已能在 staging 完成登录、lazy conversation create、history refresh、typed `answer` / `error` 结果态渲染，并留下 `.tmp/staging-smoke/20260406T080633Z-public-chat-wave5/SUMMARY.md` 证据。当前剩余工作已收敛为两项：决定何时移除 `/chat/replatform-preview*` 这条临时 debug seam，以及定位 staging `supervisor` 对部分 curriculum prompt 仍会返回 `Supervisor execution exceeded 15000ms timeout.` 的执行稳定性问题。这条工作只替换 chat web 实现基底，不改动 `public-chat-web -> app-api -> supervisor-api` 拓扑，也不把 `app-api` 改写成 upstream Chatbot backend
- [ ] 导航相关首个前向 slice 固定为 `place_lookup` / `place_finding`，先覆盖建筑、服务点与周边关键地点问法；`route_planning`、入口选择、无障碍路径与地图内路线交互后置到后续 phase

### Out of Scope

- `campus_services` query-serving 上线 — 当前阶段不把 service taxonomy 直接放进默认查询面
- 全 corpus 同步上线 — 当前完整 live release-gate 仍以 `student_handbook` 为主；`curriculum_plan` 已进入 query-serving，但当前重点是维持已落盘 live gate truth，而不是扩面到更多 corpus
- 校园路线规划 / wayfinding 首发上线 — 当前导航相关首个交付只收敛到地点寻找，不把 route graph、路线搜索和路线交互一起并入第一期
- 更细粒度的角色差异化问答行为 — 当前只做到 identity / groups 透传与 retrieval 前 ACL 过滤
- 复杂的多 specialist 串并行协作与 workflow engine — 先把显式 routing、handoff 和单条主链路骨架立住
- 完整会话记忆、HITL / approval flow、生产级运维硬化 — 这些属于后续阶段能力，不作为当前初始化范围

## Context

当前真人答疑群里存在大量校园相关问题，需要人工持续回答，已经形成明显的人力消耗；这个项目的直接业务背景就是用结构正确的校园问答助理承接这些高频问答。仓库本身是 brownfield：`docs/` 中已有长期架构、phase-1、supervisor 架构与实施计划文档，`.planning/codebase/` 也已经记录了当前代码地图。技术上，新仓库采用 supervisor-led multi-agent 方向，`../campusRAG` 是旧的 RAG 实现，只作为迁移参考；迁移目标不是复制旧接口，而是用新的 contract、retrieval abstraction 和 supervisor/specialist 边界重建主链路。

## Constraints

- **Architecture**: `supervisor` 必须是唯一入口协调层，`specialist` 作为稳定能力边界存在，不能退回成旧 `campusRAG` 的扁平 tool 模式 — 这是仓库长期架构和当前 supervisor 设计的核心前提
- **Scope**: serving surface 由 runtime profile 显式控制；当前开放 `student_handbook` 与 `curriculum_plan`，`campus_services` 保持 `offline_preparation` — 避免再次把运行策略写死在 supervisor、API shell 或 worker 默认值里
- **Contracts**: handoff 必须通过 `packages/contracts` 中的 schema 完成，不让 AgentOS / retrieval / infra 类型渗透进共享 contract — 这是未来可替换 specialist / retrieval 的基础
- **Runtime Boundary**: runtime 与 transport 逻辑留在 `apps/`，尤其是 `apps/supervisor-api`；`packages/supervisor-core` 只负责 request framing、routing、policy、response shaping、audit projection — 避免框架宿主反向污染编排层
- **Product Identity**: product-layer auth/session/principal mapping 固定留在 `apps/app-api`；`apps/supervisor-api` 只做 internal execution caller admission，并消费显式 `actor` — 避免 execution engine 重新长出产品身份语义
- **Security**: v1 必须做到身份透传、trace 透传、retrieval 前 ACL 过滤、最小审计和最小 source traceability — 这是面向不同权限用户上线前的最低治理要求
- **Execution Goal**: 当前优先级是把新架构站稳，不以覆盖更多知识域或更复杂 agent 能力为第一目标 — 避免为了功能面牺牲边界正确性

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| query-serving surface 由 runtime profile 控制 | 避免把 serving policy 写死在 supervisor、API shell、worker env 默认值或 handbook-only 约束里 | — Accepted |
| `curriculum_plan` 已进入 query-serving，`campus_services` 继续保持 `offline_preparation` | curriculum 已具备 source-truth、chunking 与 retrieval 入口；service taxonomy 仍需后续独立验证 | — Accepted |
| 导航相关首个前向 slice 固定为 `place_lookup` / `place_finding`，`route_planning` 后置 | 当前最近用户价值是回答“xx楼在哪里”“补卡机在哪里”这类高频地点问题；先冻结 `place_catalog`、alias resolve 与地点答案 contract，比先做完整路线规划更低风险且更符合当前数据完备度 | — Accepted on 2026-04-05 |
| 权限最小闭环只做到 identity / groups 透传与 retrieval 前 ACL 过滤 | 先满足多类用户的最小访问控制，再延后更细粒度角色行为 | — Pending |
| 旧 `../campusRAG` 仅作为迁移参考 | 新仓库目标是新架构落地，不是继续扩展旧实现 | — Pending |
| phase-1 先优先架构边界正确、handoff 清晰、tracing / audit / ACL 最小闭环 | 这是“符合最佳实践”的核心，也是后续扩展多 specialist 的前置条件 | — Pending |
| specialist 表示稳定能力边界，不只等于 handbook RAG | 如果官网探活 / 可达性核验是长期稳定需求，应作为独立 specialist 讨论，而不是退回 supervisor 内联 tool | — Pending |
| `official-web` / `availability` specialist 进入当前里程碑，但以 inserted phase 并行推进 | 这是长期稳定能力边界，且可以在不改写 handbook mainline 的前提下提前验证 supervisor 的多 specialist 形态 | — Validated in Phase 03.1 |
| handbook raw onboarding 必须先进入 raw bucket + raw asset registry，再允许 OCR normalized ingestion | Phase 2 要证明 raw/document truth 分层成立，不能退回本地文件路径兼容方案 | — Validated in Phase 2 |
| handbook duplicate/update 判定基于 `document_id + revision_track` 的历史内容哈希，并通过 import report 显式暴露 created/updated/skipped buckets | 后续 Phase 3/4 需要稳定的版本推进与可审计回归证据 | — Validated in Phase 2 |
| handbook chunking 必须从 registry 指向的 `document-units.jsonl` 重建，并让 ingestion/retrieval 之间共享同一套 evidence-trace metadata | Phase 3 要证明 processed truth、Qdrant payload 和 retrieval evidence shaping 已经收口 | — Validated in Phase 3 |
| `representation` 作为 Qdrant payload alias 保留在 ingestion/retrieval 边界内，shared contract 继续使用 `revision_track` | 这样可以补齐 retrieval payload 语义，同时避免 contract 泄漏或兼容层扩散 | — Validated in Phase 3 |
| `student_handbook` retrieval baseline 不再以 dense-only bootstrap 视为 accepted truth，而是升级为 `dense + sparse hybrid + RRF`，并保持 registry-backed evidence contract 不变 | handbook/规章类语料需要 sparse exact-match 与 semantic recall 同时成立；仅冻结 dense-only 已不符合当前 accepted implementation direction | — Accepted on 2026-03-26 |
| handbook embedding baseline 固定为 `Qwen3-Embedding-4B @ 2560`，不得依赖兼容 API 默认 `1024` 维返回 | 当前 collection/query runtime 必须围绕统一向量宽度重建和验证，不能继续容忍 provider 默认维度漂移 | — Accepted on 2026-03-26 |
| handbook chunk-truth 调整必须先经过真实 validation 与 sample markdown 复核，再允许继续 embedding 或进入 retrieval/eval 调参 | 这次问题说明仅靠单元测试不足以覆盖 handbook 的真实 cleanup/chunking 退化；必须把 live validation 和真实样本内容作为阶段门禁 | — Re-confirmed on 2026-03-26 |
| `rag-specialist` answer path now fail-closes ambiguous, empty-support, and retrieval-failure outcomes while composing grounded chunk-cited answers from the accepted hybrid evidence bundle | Phase 4 must close handbook answer semantics without reopening retrieval strategy or shifting policy back into supervisor | — Validated in Phase 4 |
| `bearer` auth is now runtime-owned and no longer trusts client-supplied `x-actor-*` headers; `trusted-worker` projects final caller actor claims from forwarded Access JWT payload after origin trust is verified | Phase 5 must close actor propagation and ACL safety without moving auth/provider semantics into `packages/*` | — Validated in Phase 5 |
| durable audit logging lives at the API shell boundary while supervisor-core remains the owner of audit record shape | This preserves runtime ownership for persistence and package ownership for schema/projection | — Validated in Phase 5 |
| Cloudflare 并行后续工作拆成 `04.2` / `04.3` / `04.4` 三个 inserted phase | 主线被 chunk-truth 阻塞时，可以继续推进 edge/runtime/panel-shell 冻结，但必须避免把 provider、identity、ACL、audit 语义推入 `packages/*` 或提前吃掉 Phase 5 | — Pending in Phase 04.x |
| Cloudflare public answer path now runs through `apps/public-entry-worker -> apps/supervisor-api` with explicit trusted-worker origin auth | 先把 public-entry runtime seam 做成真实可验证代码，再把 app-layer actor/ACL/audit留给 Phase 5 | — Validated in Phase 04.6 |
| public/protected product surface 收口为 `apps/public-chat-web` 与 `apps/protected-panel-web` 两个 Worker web surface | 浏览器保持 public/protected 分离，但不再各自长出独立产品后端 | — Accepted on 2026-03-28 |
| `public-consumer-chat` 的 04.7 `Better Auth + Supabase Postgres` 与 `TanStack Start` 结论保留为历史实现参考，不再作为 forward backend truth | 这些结论解释了已合入 `main` 的 04.7 实现，但后续产品方向已经收口为 `public-chat-web` / `protected-panel-web` + shared `app-api` | — Superseded by ADR-0012 on 2026-03-28 |
| shared `app-api` 作为 public chat 与 protected panel 的共同产品后端 | 需要把 auth/session/conversation、chat ingress、request ledger / projection input 与 operator query 收口在一个 shared app boundary，而不是继续分裂成 consumer full-stack app + operator query backend | — Accepted on 2026-03-28 |
| `apps/supervisor-api` 退为 execution engine，不再承担 product-facing backend | shared app backend 可以承接浏览器产品 API，而 supervisor 继续只拥有 orchestrator execution path | — Accepted on 2026-03-28 |
| `apps/app-api` runtime 冻结为 Worker，而不是继续保持 runtime-agnostic | 这能避免 shared product backend 再次滑回 Docker-first / 双后端裂缝，并保持与 Worker web surfaces 的 internal-only seam 一致 | — Accepted on 2026-03-28 |
| canonical request projection 由 shared `apps/app-api` command path 一次产出，并由 `app-api` 暴露 panel `Requests` query surface | 这能避免把 panel、consumer chat、telemetry sink 或 `apps/supervisor-api` 错当成 request list/detail truth | — Accepted on 2026-03-28 |
| `apps/app-api` 是唯一的 product-layer auth/session/principal owner；`apps/supervisor-api` 只做 internal execution caller admission | 这能避免 execution engine 继续从 edge/header 恢复最终业务 actor，并把 product identity 明确收口在 shared app boundary | — Accepted on 2026-03-28 |
| canonical user context 固定拆为 `verified identity`、`profile memory`、`session memory`、`institutional knowledge` 四层真相 | 这样可以引入长期记忆与个性化，同时避免 memory 提权、污染机构知识真相或绕过 retrieval ACL | — Accepted on 2026-03-28 |
| personalization 可以影响 intent framing、retrieval planning 与 answer wording，但 memory 不能授权或扩大 retrieval ACL | 这样可以引入长期记忆而不破坏 retrieval fail-close 与 runtime-profile-driven serving policy | — Accepted on 2026-03-28 |
| canonical request projection 采用 same-database outbox-first：`runtime.request_execution` + `runtime.projection_outbox` 是第一 durable truth | 这能避免 queue-first、日志重算或 panel 侧事后拼装造成的多真相源与时序漂移 | — Accepted on 2026-03-28 |
| Better Auth 位于 `apps/app-api`，且 `auth/chat/runtime/operator` 共享一套 Drizzle schema codebase 与 migration pipeline | 这能避免 auth 表和 app-domain 表分裂成两套迁移世界观，同时保持 Worker runtime 与数据库管理路径清晰分离 | — Accepted on 2026-03-28 |
| 当前 merged truth 把 `ContextProjection` / `SupervisorResponse` 视为 shared seam；后续改动不得把旧 `snapshot` 路径带回主线 | 这能吸收当前集成线的 typed projection / eval contract，并避免把历史过渡态重新写回 merged truth | — Accepted on 2026-03-28 |
| shared `apps/app-api` foundation 已在当前 merged truth 落地，panel `Requests` 不再属于 blocked follow-up | 后续工作应转向 integration hardening、observability verification 与 stale-truth cleanup，而不是重复讨论 shared backend topology 是否存在，也不再把 curriculum gate 记为这条非 live 执行线的 follow-up | — Validated on 2026-03-29 |
| protected panel 面向小团队 operator principal，不额外自建 end-user user system；`Jobs` / `Operations` 默认不进首发 rollout | 这能保持 panel 是受控 operator control plane，而不是用户系统、CMS、数据库控制台或万能后台 | — Accepted on 2026-03-28 |
| `official_web` control plane 收口到 shared `apps/app-api`，而不是新建 crawler-intake backend | 这能复用现有 app-owned admission、ledger、outbox 与 operator read-model 形态，同时保持 `apps/ingestion-worker` 继续只是 offline executor | — Accepted on 2026-03-29 |
| worktree-local `v1.0` audit 已在 Phase 9 收口到 `tech_debt`，不再把缺失 planning 文件当作 blocker | 这样可以把后续 `official_web/muc_public_pages` 数据面工作与 retroactive evidence cleanup 明确拆开，避免继续混淆 archive scaffold 与能力闭环 | — Accepted on 2026-04-02 |
| `official_web/muc_public_pages` 当前 truth 现已显式拆成 `release_gate_required` / `retain_inventory_only` / `future_fresh_news_surface` 三层 | 这能把当前 stable-reference-like 质量治理、保留型 inventory truth 与未来 news surface handoff 明确分开，避免继续把 `inventory_only` 当成默认待升格队列 | — Accepted on 2026-04-04 |
| `official_web` support-only article lines 现保留为 source-truth unit role，但不得进入 canonical markdown、chunk/index、retrieval ranking 或 answer row selection；promotable header 对有效 section-path 固定采用 labeled contract，对 title-collapsed 页面允许 title-only labeled header | 这能在保留审计可追溯性的同时关闭 `source_only` / `terminal_boilerplate` / header drift 与 notice-fact false positive，而不是继续依赖下游猜测性过滤 | — Validated on 2026-04-04 |
| `official_web` 的长期 retrieval split 固定为 `official_web/stable_reference`、`official_web/fresh_news`、`official_web/news_archive`，而正式规章/手册与正式培养方案继续进入并列的 `regulations/*`、`curriculum/*` | 这能避免把 source channel、官网 URL 来源与 retrieval corpus 强行绑成一层，也避免继续扩出 `official_web/regulation` / `official_web/curriculum` 这类重复语义层 | — Accepted on 2026-04-05 |
| `official_web` corpus split 的第一条执行链路采用 repo-tracked projection routing + scope-specific import filtering；未命中的页面继续留在 `muc_public_pages` bridge | 这能先把 `official_web/stable_reference` 路由/import 跑通，同时保持 fresh-news 与后续跨 corpus fan-out 仍需单独 phase，而不是在一次 refresh 中隐式扩 scope | — Validated on 2026-04-05 |
| stable-reference-like official-web serving semantics 由 repo helper 统一表达，并同时覆盖 mixed bridge 与 `stable_reference` split scope | 这能避免 retrieval / specialist / eval 继续把参考页逻辑绑死在 `muc_public_pages`，同时不把 `fresh_news` / `news_archive` 混进当前说明型 surface | — Validated on 2026-04-05 |
| `official_web/stable_reference` 的 serving alias 在 split-scope qrels/live gate 通过后单独发布，而 `muc_public_pages` 的陈旧 mixed alias 直接撤下 | 这能让当前 worktree-local query-facing official-web surface 与真实可消费 collection 对齐，同时避免继续把 mixed bridge 冒充成长期 serving surface | — Validated on 2026-04-05 |
| `official_web/fresh_news` seed import/release 允许在本地验证阶段使用 injected registry path，只要真实对象存储、真实 Qdrant、repo-tracked manifest/qrels/live gate 全部成立 | 这能在 shared Postgres pooler 短时饱和时继续验证 chunk/index/retrieval 质量，而不把一次本地基础设施波动误写成语料或 runtime 设计 blocker | — Validated on 2026-04-05 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (users, feedback, metrics)

---
*Last updated: 2026-04-06 after advancing Wave B staging closure to real remote evidence and shrinking the remaining blockers to panel identity plus Sentry sink-side access*
