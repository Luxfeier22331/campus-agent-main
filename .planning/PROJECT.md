# Campus Agent

## What This Is

`campus-agent` 是一个面向学生、教职工和潜在考生的 multi-agent 校园问答助理仓库，长期形态是以 `supervisor` 作为唯一入口、`agent` 作为能力边界的 supervisor-led orchestration system。当前 v1 的重点不是一次性做全量校园知识问答，而是在新架构下把 `supervisor -> rag-agent -> retrieval` 主路径稳定成立，并让 serving surface 由 runtime profile 显式控制。当前 query-enabled surface 是 `student_rules` 与 `curriculum_plan`；`campus_services` 仍保持 offline preparation。旧仓库 `../campusRAG` 只作为迁移参考，不再作为继续扩展的主实现。

## Planning File Contract

- `PROJECT.md`
  - 项目级真相：产品范围、validated/active/out-of-scope、关键决策，以及会影响执行优先级的当前 truth
- `WORKSTREAMS.md`
  - repo 级 workstream registry：active / deferred / backlog / legacy 的唯一总览，以及 slug / native-dir / reopen rule
- `.planning/workstreams/<slug>/STATE.md`
  - 单条 workstream 的 current slice、blockers、recent verification 与 continuity
- `.planning/workstreams/<slug>/ROADMAP.md`
  - 单条 workstream 的 phase 顺序与完成状态
- `.planning/workstreams/<slug>/REQUIREMENTS.md`
  - 单条 workstream 的目标、范围、non-goals 与 success criteria
- `.planning/legacy-flat/`
  - 原 flat planning archive；保留历史 phase / milestone 叙事，不再承载当前执行真相

## Current Truth

- 当前 serving surface 由 collection runtime profile 控制，不再由早期 `phase-1` 路由文案单独定义
- 当前 query-enabled scope 是 `regulations/student_rules` 与 `curriculum/curriculum_plan`
- `student_rules` 与 `curriculum_plan` 的 source OCR runtime profile 当前都已切到 `mineru_api + vlm + mineru-vlm-adapted-v2`；覆盖历史 Paddle 派生 canonical truth 的 cutover 现由独立 `handbook-curriculum-mineru-cutover` workstream 收口
- `campus_services/*` 仍为 `offline_preparation`
- 当前分支模型固定为：`develop` 承担长期集成，`main` 承担稳定发布，`main` 上的改动只通过 PR 进入
- retrieval 读取 serving alias；离线索引发布写入 versioned physical collection，并以 release manifest 保留追溯信息
- planning 执行面当前按原生 workstream-first 多线推进；repo 级总览固定收口到 `.planning/WORKSTREAMS.md`，单条线的当前真相固定收口到 `.planning/workstreams/<slug>/`
- repo 级默认 agent execution 入口现已提升为 `scripts.workstream_harness`：底层继续复用 `workstream_claim` lease/heartbeat substrate，但默认终态已收口为 `completed / blocked / failed_needs_repair` 的 harness contract；runtime ledger 只写入 gitignored `.planning/runtime/harness/`
- shared `apps/app-api` Worker backend、`apps/public-chat-web`、`apps/protected-panel-web` 已在当前工作树落地
- 正式 `apps/public-docs` docs shell 已在当前工作树落地；当前仍由 `document-site-and-canonical-reader` workstream 继续收口 published reader assets、same-site docs control-plane 与 shell consumption truth
- `public-chat-web` 当前 public auth family 已覆盖 `/login`、`/register`、`/forgot-password`、`/reset-password`；`protected-panel-web` 的 `/login` 继续只代表 Cloudflare Access reentry
- panel `Requests` 已接上 `apps/app-api` 的 runtime-owned request projection APIs；不得绕回 audit log、telemetry sink、consumer chat tables 或 `apps/supervisor-api`
- `official_web` control plane 已在 shared `apps/app-api` 落地，collector admission、crawl-run ledger、operator query 与 ingestion handoff 继续收口在同一 Worker backend；`apps/ingestion-worker` 继续只是 offline executor
- canonical app identity、profile memory 与 session truth 归属 shared `app-api`；execution engine 只消费 typed projection
- personalization 可以利用 verified identity / profile memory / session summary，但 memory 不得授予权限或绕过 retrieval ACL
- 04.7 `public-consumer-chat` 现仅作为历史实现参考，不再覆盖 forward topology truth
- 当前 merged truth 已按 `ContextProjection` / `SupervisorResponse` / eval supervisor seam 收口；后续改动不得回退到旧 `snapshot`
- worktree-local `v1.0` evidence chain 已在 Phase 9 收口；official-web 当前不再缺 release-lifecycle plumbing。Phase 10.3 完成后的 final replay `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v9` 现已进一步滚入本地 import/release candidate：unpublished release `r20260404_184508` 已通过 `document_count=21 / point_count=109 / validation_status=passed`、retrieval qrels `9/9` 与 deterministic live gate `13/13`；后续如需继续推进，应单独决定是否 publish alias，而不是重新争论 fixed-scope clean/chunking
- `student_rules` 当前最新 release-truth artifact 已更新为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260419T031500`；三轮 deterministic `11/11` 全通过、`repair=0`，`supplemental_verdict` / `final_overall_verdict` 当前均为 `pass`；`ragas.faithfulness` soft gate 已在本轮 closeout 中恢复为 `pass`
- `curriculum_plan` 当前 latest completed live artifact 已更新为 `.tmp/evals/curriculum-plan-live-gate-accept-phase1000`；2026-04-13 fresh accept 三轮 `19/19` 全通过，`final-summary.json` 为 `deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`。旧 `20260404T200443Z` / `20260410-wave-c` 现只保留为历史 evidence，不再代表当前 curriculum truth
- `curriculum_plan` 的 `课程地图 / 拓扑图` query 继续保持 fail-close；`curriculum-course-map-multimodal-probe` workstream 已在 2026-04-25 完成 docs-only materialization closeout：`Responses + gpt-5.5` 已补齐公开文档站所需课程地图 reader assets，最终覆盖为 46/46 个培养方案、79/79 个课程地图块。课程地图仍不写回 source-truth、document-units、chunks、embedding 或 query-serving；后续 UI/UX 展示打磨继续由 deferred `curriculum-course-map-docs-presentation-refinement` 承接
- `official_web/muc_public_pages` 当前 worktree-local current truth 已显式收口为 `21` 条 promotable 文档：`11` 条 `release_gate_required`、`2` 条 `retain_inventory_only`、`8` 条 `future_fresh_news_surface`；只有 `release_gate_required` 子集进入当前 answer-quality gate
- `official_web/muc_public_pages` 已在 2026-04-02 为较早一轮 imported dataset 闭环 registry-backed release + alias lifecycle，但当前 published alias 仍停留在 1 条 listing-heavy `generic_content_page` 记录；collection 继续保持 `offline_preparation`，并且只应被视为 mixed 过渡 collection，而不是长期最终 corpus split
- Phase 10.4 已把 `official_web` corpus split 的第一条执行链路落地：repo 现在有 `projection-routing.json` truth，stable-reference bootstrap 子集可从 replay 直接路由到 `official_web/stable_reference`，并且 mixed replay output 可以按请求 scope 单独导入
- Phase 10.5 已把 `official_web/stable_reference` 的第一条真实 replay/import/release 证据落盘；2026-04-05 又通过 `campus_ingestion_worker.scope_alias` 把 `official_web_stable_reference` 发布到 `official_web_stable_reference__r20260404_204033`，并确认 alias-path retrieval/live gate 继续通过
- retrieval / agent / eval 当前已不再把 stable-reference-like official-web 语义绑死在 `muc_public_pages`；同一套规则现在同时适用于 mixed bridge 与 `stable_reference`
- `official_web/stable_reference` 当前已有 repo-tracked split manifest、retrieval qrels 与 deterministic live-gate baseline；2026-04-05 本地实跑已确认 retrieval `hit@1=1.0 / recall@5=1.0 / forbidden_hit_rate=0.0`，deterministic live gate `11/11 pass`
- `official_web/muc_public_pages` 的旧 serving alias 已在 2026-04-05 主动撤下；mixed bridge 继续保留为 replay/QC/regression truth，但不再维持一个误导性的 published alias
- `official_web/fresh_news` 当前也已补齐 repo-tracked split manifest、retrieval qrels 与 deterministic live-gate seed baseline；2026-04-05 本地 `8` 文档 seed import/release 生成 `official_web_fresh_news__r20260404_222909`，retrieval `8/8 hit@1`、live gate `8/8 pass`，但 runtime truth 仍保持 `offline_preparation`
- Phase 1003 已把 `official_web/fresh_news` / `official_web/news_archive` 的 repo-level opening policy、runtime-profile contract 与独立 worktree opening checklist 冻结为长期真相；后续真实 opening execution / acceptance 已下调到 backlog `999.4`，当前不再作为 adjacent lane 或 active implementation lane
- `campus_notices/internal_notice` 已在 local Postgres + local MinIO + cloud Qdrant 路径上完成 current-scope replay -> verified preparation -> single promote -> unpublished release：`promotion_id=promotion-0001`、`release_id=r20260411_090101`、physical collection `internal_notice__r20260411_090101`、`document_count=21`、`point_count=213`、`validation_status=passed`，且 serving alias `internal_notice` 仍未发布；runtime truth 继续保持 `restricted + offline_preparation`
- authenticated-notice 的后续工作当前收口为两条前向线加两条已完成 closeout：`notice-consumption-layer` 已完成 implementation closeout，repo 现有 `source_notice -> derived consumption unit` persisted projection、显式 rebuild/status worker、import rebuild seam、regulation/scoped ready gate、non-regulation coverage 与 operator read-model truth；已捕获 corpus 的 bounded regulation/scoped downstream consumption 继续由独立 workstream 负责 target-side hardening；`file_release owner recovery` 的 auth-window readiness closeout 已完成，`351119` 已被显式排除，未来 target-specific recovery 必须先 admission 新的 non-excluded target 才能 reopen；`live portal / authenticated control-plane` 继续保持 deferred。对 `355222` 比选公告与 `355325` 中选结果公示这类 procurement notice，当前已进入 `procurement_notice` notice category / projection truth；`service_status_override` 与 `attachment_form_template` 也只作为 held projection truth，不打开 campus-services runtime、document center、query-serving 或 panel surface
- 当前 worktree 已完成 Wave E place-finding foundation 的 repo-internal 资产：repo-owned `campus_navigation/place_catalog` seed/runtime-profile、`packages/navigation-agent` 与 `place_lookup` / `place_card` contract 仍保留在仓库中；但按 2026-04-14 产品决策，当前 supervisor 产品路径已对校内导航 fail-close，`place_card` / map consumption 延后到地图实际上线后再恢复。在合入 `develop` 前，这仍属于 worktree-local progress，而不是 merged truth
- 当前 worktree 已完成 Phase 14 `产品主链路 Prompt Stack 与 System Prompt Runtime 收口`：`apps/supervisor-api`、`packages/supervisor-core`、`packages/rag-agent`、`apps/app-api` 与 `packages/evals` 现已统一收口 prompt metadata sink、typed prompt runtime state 与 deterministic-path regression coverage；在合入 `develop` 前，这仍属于 worktree-local progress，而不是 merged truth
- 当前 worktree 已完成 Phase 16 `OCR 资产分类与双渠道择优路由` closeout：compare lane 现已输出 `asset_typing` / `routing_recommendation`，`source_truth_only` 对 `generic_image` 现已支持 Paddle + MinerU 双跑判型、`ocr-routing-decision.json` evidence 与 raw-asset refined type 回写；当前冻结的 canonical scope 是 `pdf -> MinerU primary`、`simple_table_image -> Paddle primary`、`complex_table_image -> MinerU primary`、`spatial/office -> deferred`，而不是把 MinerU 升格成全局 canonical OCR provider
- 当前 worktree 已完成 `shared-file-asset-loader-contract` 的 `Phase H`：legacy Office canonical path 现已切到 service-backed client，repo 已拥有 `JODConverter + LibreOffice` self-hosted conversion runtime、统一的 `LEGACY_OFFICE_CONVERSION_*` env/runbook truth，以及真实 authenticated notice `.doc/.xls` closeout evidence
- 早期 roadmap / phase 文档主要承担历史排期与讨论存档，不应覆盖这里的当前 truth

## Core Value

以已冻结的 supervisor-led multi-agent 架构和已落盘 serving/eval truth 为基础，完成验收收口、上线前硬化与真实产品面一致性，而不是继续把仓库当作地基期实验场。

## Requirements

### Validated

- ✓ 仓库已经建立 supervisor-led 的长期架构边界与 phase-1 约束文档，明确 `apps/` 与 `packages/` 的职责划分 — existing
- ✓ 已存在 `supervisor-api -> supervisor-core -> rag-agent -> retrieval-core` 的主链路骨架与共享 contract 边界 — existing
- ✓ 已存在 ingestion/data plane 基础设施骨架，可支持 `student_rules` 与 `curriculum_plan` 的 raw / processed / chunk 路径演进 — existing
- ✓ 已完成 `student_rules` 的 canonical raw onboarding、稳定逻辑文档 identity/version 规则与 machine-checkable duplicate/update import reporting — Validated in Phase 2
- ✓ 已完成 `student_rules` 的 canonical processed artifact、chunk metadata 与 Qdrant/retrieval payload handoff 收口 — Validated in Phase 3
- ✓ 已通过 `Phase 03.1` 验证 shared supervisor/agent seam 可承载并行 capability family；早期实验性的 `availability-specialist` 占位符已于 2026-04-21 退休，不再属于当前 merged truth — Boundary validated in Phase 03.1, placeholder retired on 2026-04-21
- ✓ 已完成 `student_rules` 的 `rag-agent` answer path 收口，包括 grounded answer、chunk-level citation、`needs_clarification`、`no_answer` 与 `error` 语义 — Validated in Phase 4
- ✓ 已完成 `student_rules` retrieval baseline 从 dense-only bootstrap 收口为 `dense + sparse hybrid + RRF + registry-backed evidence`，并通过 live handbook fixture 与 repo tests 验证 — Validated by 2026-03-27 live + automated verification
- ✓ 已完成 `supervisor -> agent` 查询入口、typed actor propagation 与 durable audit logging 的 Phase 5 收口 — Validated in Phase 5
- ✓ 已完成 Cloudflare public-entry Worker runtime shell、trusted-origin forwarding 与 `apps/supervisor-api` trusted-worker origin admission — Validated in Phase 04.6
- ✓ 已完成 `public-consumer-chat` 的 04.7 app boundary / frontend host / auth-and-storage closeout，并已把实现与文档基线合入 `main`；该实现现作为历史参考而非 forward backend truth — Validated in Phase 04.7
- ✓ 已完成 shared `apps/app-api` Worker foundation、request projection API 与 `public-chat-web` / `protected-panel-web` 接线收口 — Validated on 2026-03-29
- ✓ 已完成 `student_rules` 主链路的基础 eval / smoke / release-gate 验证，包含 live qrels benchmark、workflow/status 样本与 handbook collection schema 快照 — Validated in Phase 7
- ✓ 已完成 repo-head `student_rules` live acceptance rerun，`2026-03-31 210128` 正式 artifact 已确认 expanded release-gate、`procedure_directness` 与所有 supplemental soft gate 全量通过 — Validated on 2026-03-31
- ✓ 已完成 `official_web -> app-api` control-plane ownership、contract、lifecycle、schema 与实施基线文档冻结 — Validated on 2026-03-29
- ✓ 已完成 `official_web -> app-api` control-plane foundation 实现，包含 collector command/query APIs、outbox 驱动的 operator projections 与 ingestion handoff，以及 protected panel `Official Web` domain — Validated on 2026-03-29
- ✓ 已完成 `official_web` corpus split 第一阶段执行面：repo-tracked projection routing 已把首批 stable-reference 页面从 `muc_public_pages` bridge 分流到 `official_web/stable_reference`，且 mixed replay output 已支持 scope-specific import 而不放宽 single-scope refresh — Validated in Phase 10.4
- ✓ 已完成 `official_web/stable_reference` 的首条真实 release-evidence 与 serving-side cleanup：repo 已记录真实 `stable_reference` physical release，并让 retrieval / agent / eval 辅助逻辑支持 split scope 与 mixed bridge 共存 — Validated in Phase 10.5
- ✓ 已完成 `apps/public-chat-web` strict donor parity Wave 6 closeout：donor diff whitelist 已落盘，`share / visibility on launch path` blocker 已关闭，fresh local gate 与 authenticated staging smoke 已在 `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/` 收口；`/api/models` staging `200`、`/api/history` 在真实 cookie session 下 `200` — Validated on 2026-04-09
- ✓ 已在当前 worktree 完成 Wave E place-finding foundation：repo 现已具备 `campus_navigation/place_catalog` seed/runtime-profile、`navigation-agent`、`place_lookup` contract/routing 与预留的 `place_card` consumer chain，并通过 targeted Python/Vitest/TypeScript 验证；但该能力已于 2026-04-14 从当前产品路径主动收回，等待地图实际上线后再恢复 — Validated on 2026-04-11, rollout paused on 2026-04-14
- ✓ 已完成 Phase 13 `政治风险判定与幻觉控制硬化`：supervisor policy/scope、rag grounding validator、cross-cutting release-gate cases 与 app-api request observability fallback 已统一收口，`policy_refusal / out_of_scope / unsupported_by_evidence` 现在都有 machine-checkable eval + observability truth — Validated on 2026-04-11

### Active

- [ ] Phase 1000 `Curriculum 结构化证据契约与 Semester Facts 修复` 已完成 closeout；curriculum 线当前不再是 active implementation lane，若后续触碰旧 planning/docs，只允许把 historical artifact pointer 收敛到 `.tmp/evals/curriculum-plan-live-gate-accept-phase1000`
- [ ] authenticated-notice 当前 active 数据面 follow-up 继续只保留非认证的 downstream consumption：它负责 unpublished `internal_notice` release 之后的 post-release retrieval-prep、`regulations/institutional_rules` / `regulations/scoped_rules` 承接与 target-side quality hardening；auth-dependent `file_release owner recovery` 已在独立 workstream 完成 readiness closeout，不再混入本线
- [ ] staging@ayafeed.com 的项目隔离一级子域部署基线已经成立；`campus-api-staging`、`campus-chat-staging`、`campus-panel-staging` 当前 truth 稳定，后续 release hardening 已收口为 Phase 1002 `Worker 部署与发布硬化收口`
- [ ] `shared product surfaces acceptance / hardening` 已在 `Phase I` closeout 之后继续 reopen 到 `Phase J` Turnstile posture productization：固定方向是 always-on verification、Cloudflare-managed adaptive interactive challenge only on elevated risk，以及 local / staging / prod runtime posture seam；`Phase K` 的 mature auth shell local cutover 已完成，但 workstream 当前仍只剩 `Phase J` 真实 staging 浏览器 closeout blocker；它继续只覆盖 shared backend、public chat 与 protected panel，不改 panel Access model
- [ ] `official_web/fresh_news` / `official_web/news_archive` 的 repo-level runtime opening criteria 已在 Phase 1003 冻结；后续 opening execution / acceptance 已下调到 backlog `999.4`，当前只保留 `stable_reference` 与 default-off news contract，不在 active implementation lane
- [ ] 校内导航当前不在 active rollout；现阶段只保留 `place_catalog` / `navigation-agent` foundation，地图实际上线后再从 backlog 恢复 `place_lookup` 产品路径与 `place_card` / map consumption
- [ ] repo-wide handwritten large-file decomposition 仍是 active lane：当前 reopened inventory 重新 admission 了 `internal_notice_regulation_materialization.py`、`tests/ingestion/test_curriculum_provider_normalize.py` 与 `tests/test_public_docs_sync.py` 三个 `800+` handwritten 文件；后续必须在独立 phase 中继续拆解，而不是把这些技术债夹带进 notice / ingestion / retrieval / product surface 业务 workstreams

### Out of Scope

- `campus_services` query-serving 上线 — 当前阶段不把 service taxonomy 直接放进默认查询面
- 全 corpus 同步上线 — 当前完整 live release-gate 仍以 `student_rules` 为主；`curriculum_plan` 已进入 query-serving，但当前重点是维持已落盘 live gate truth，而不是扩面到更多 corpus
- 校内导航当前产品上线 — 地图实际上线前，`place_lookup` 也不进入当前支持面；route graph、路线搜索、路线交互与 `place_card` / map consumption 一并后置
- 更细粒度的角色差异化问答行为 — 当前只做到 identity / groups 透传与 retrieval 前 ACL 过滤
- 复杂的多 agent 串并行协作与 workflow engine — 先把显式 routing、handoff 和单条主链路骨架立住
- 完整会话记忆、HITL / approval flow、生产级运维硬化 — 这些属于后续阶段能力，不作为当前初始化范围

## Context

当前真人答疑群里存在大量校园相关问题，需要人工持续回答，已经形成明显的人力消耗；这个项目的直接业务背景就是用结构正确的校园问答助理承接这些高频问答。仓库本身是 brownfield：`docs/` 中已有长期架构、phase-1、supervisor 架构与实施计划文档，`.planning/codebase/` 也已经记录了当前代码地图。技术上，新仓库采用 supervisor-led multi-agent 方向，`../campusRAG` 是旧的 RAG 实现，只作为迁移参考；迁移目标不是复制旧接口，而是用新的 contract、retrieval abstraction 和 supervisor/agent 边界重建主链路。

## Constraints

- **Architecture**: `supervisor` 必须是唯一入口协调层，`agent` 作为稳定能力边界存在，不能退回成旧 `campusRAG` 的扁平 tool 模式 — 这是仓库长期架构和当前 supervisor 设计的核心前提
- **Scope**: serving surface 由 runtime profile 显式控制；当前开放 `student_rules` 与 `curriculum_plan`，`campus_services` 保持 `offline_preparation` — 避免再次把运行策略写死在 supervisor、API shell 或 worker 默认值里
- **Contracts**: handoff 必须通过 `packages/contracts` 中的 schema 完成，不让 AgentOS / retrieval / infra 类型渗透进共享 contract — 这是未来可替换 agent / retrieval 的基础
- **Runtime Boundary**: runtime 与 transport 逻辑留在 `apps/`，尤其是 `apps/supervisor-api`；`packages/supervisor-core` 只负责 request framing、routing、policy、response shaping、audit projection — 避免框架宿主反向污染编排层
- **Product Identity**: product-layer auth/session/principal mapping 固定留在 `apps/app-api`；`apps/supervisor-api` 只做 internal execution caller admission，并消费显式 `actor` — 避免 execution engine 重新长出产品身份语义
- **Security**: v1 必须做到身份透传、trace 透传、retrieval 前 ACL 过滤、最小审计和最小 source traceability — 这是面向不同权限用户上线前的最低治理要求
- **Execution Goal**: 当前优先级是把新架构站稳，不以覆盖更多知识域或更复杂 agent 能力为第一目标 — 避免为了功能面牺牲边界正确性

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Phase 13 将把政治相关风险处理固定为 `policy gate + scope gate + grounding gate` 三分，而不是 keyword refusal；hallucination control 固定为 bounded evidence + post-LLM validation + eval gate | 这既符合 repo 已接受的 prompt/safety architecture，也避免把校园 factual political 问题错拒、把域外问题误当召回失败、或让证据不足问题继续靠模型补齐 | — Accepted on 2026-04-11 |
| query-serving surface 由 runtime profile 控制 | 避免把 serving policy 写死在 supervisor、API shell、worker env 默认值或 handbook-only 约束里 | — Accepted |
| `curriculum_plan` 已进入 query-serving，`campus_services` 继续保持 `offline_preparation` | curriculum 已具备 source-truth、chunking 与 retrieval 入口；service taxonomy 仍需后续独立验证 | — Accepted |
| 校内导航当前不作为已开放产品能力；Wave E 只保留 repo-internal foundation，`place_lookup` supervisor 产品路径先 fail-close，`place_card` / map consumption 等待地图实际上线后再恢复 | 当前 place truth、agent contract 与 seed 扩面仍有长期价值，但地图产品面未实际开放前，不应继续把导航回答和前端消费写成当前支持 truth | — Accepted on 2026-04-14 |
| 导航相关首个前向 slice 固定为 `place_lookup` / `place_finding`，`route_planning` 后置 | 当前最近用户价值是回答“xx楼在哪里”“补卡机在哪里”这类高频地点问题；先冻结 `place_catalog`、alias resolve 与地点答案 contract，比先做完整路线规划更低风险且更符合当前数据完备度 | — Accepted on 2026-04-05 |
| Wave E 曾完成“文本答案 + location card + 可选单点预览”的 repo-local foundation，其中 `app-api` 可持久化 `place_card`、前端可映射中文地点卡片 | 这条 consumer chain 仍保留为后续地图上线后的恢复基础，但 2026-04-14 起不再代表当前已开放产品 truth | — Validated on 2026-04-11, superseded as current rollout truth on 2026-04-14 |
| 权限最小闭环只做到 identity / groups 透传与 retrieval 前 ACL 过滤 | 先满足多类用户的最小访问控制，再延后更细粒度角色行为 | — Pending |
| 旧 `../campusRAG` 仅作为迁移参考 | 新仓库目标是新架构落地，不是继续扩展旧实现 | — Pending |
| phase-1 先优先架构边界正确、handoff 清晰、tracing / audit / ACL 最小闭环 | 这是“符合最佳实践”的核心，也是后续扩展多 agent 的前置条件 | — Pending |
| agent 表示稳定能力边界，不只等于 handbook RAG | 如果官网探活 / 可达性核验是长期稳定需求，应作为独立 agent 讨论，而不是退回 supervisor 内联 tool | — Pending |
| 早期实验性的 `official-web` / `availability` placeholder 只用于验证多-agent seam，现已退休 | 继续把实验占位符保留为 current truth 会把边界验证误写成长期能力承诺；验证目标已完成，placeholder 应从 merged truth 清出 | — Superseded and retired on 2026-04-21 |
| handbook raw onboarding 必须先进入 raw bucket + raw asset registry，再允许 OCR normalized ingestion | Phase 2 要证明 raw/document truth 分层成立，不能退回本地文件路径兼容方案 | — Validated in Phase 2 |
| handbook duplicate/update 判定基于 `document_id + revision_track` 的历史内容哈希，并通过 import report 显式暴露 created/updated/skipped buckets | 后续 Phase 3/4 需要稳定的版本推进与可审计回归证据 | — Validated in Phase 2 |
| handbook chunking 必须从 registry 指向的 `document-units.jsonl` 重建，并让 ingestion/retrieval 之间共享同一套 evidence-trace metadata | Phase 3 要证明 processed truth、Qdrant payload 和 retrieval evidence shaping 已经收口 | — Validated in Phase 3 |
| `representation` 作为 Qdrant payload alias 保留在 ingestion/retrieval 边界内，shared contract 继续使用 `revision_track` | 这样可以补齐 retrieval payload 语义，同时避免 contract 泄漏或兼容层扩散 | — Validated in Phase 3 |
| `student_rules` retrieval baseline 不再以 dense-only bootstrap 视为 accepted truth，而是升级为 `dense + sparse hybrid + RRF`，并保持 registry-backed evidence contract 不变 | handbook/规章类语料需要 sparse exact-match 与 semantic recall 同时成立；仅冻结 dense-only 已不符合当前 accepted implementation direction | — Accepted on 2026-03-26 |
| handbook embedding baseline 固定为 `Qwen3-Embedding-4B @ 2560`，不得依赖兼容 API 默认 `1024` 维返回 | 当前 collection/query runtime 必须围绕统一向量宽度重建和验证，不能继续容忍 provider 默认维度漂移 | — Accepted on 2026-03-26 |
| handbook chunk-truth 调整必须先经过真实 validation 与 sample markdown 复核，再允许继续 embedding 或进入 retrieval/eval 调参 | 这次问题说明仅靠单元测试不足以覆盖 handbook 的真实 cleanup/chunking 退化；必须把 live validation 和真实样本内容作为阶段门禁 | — Re-confirmed on 2026-03-26 |
| `rag-agent` answer path now fail-closes ambiguous, empty-support, and retrieval-failure outcomes while composing grounded chunk-cited answers from the accepted hybrid evidence bundle | Phase 4 must close handbook answer semantics without reopening retrieval strategy or shifting policy back into supervisor | — Validated in Phase 4 |
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
| repo 级执行面采用原生 GSD workstream-first 多线开发；repo 总览固定写入 `.planning/WORKSTREAMS.md`，单条线状态写入 `.planning/workstreams/<slug>/STATE.md` | 当前会话已按模块边界并行推进不同工作；继续维持共享根 `STATE.md` 会让 planning 入口真相失真，也会诱导会话互相改写不相关 workstream 状态 | — Accepted on 2026-04-19 |
| repo-wide harness engineering 必须作为独立 execution infrastructure workstream 推进，并以 vendor-neutral contract + Codex first adapter 落地；不得把产品侧 `approval_required` 或任何产品 runtime state 复用到 harness | 这条线服务的是仓库执行语义，而不是产品请求生命周期；如果把 harness 混入 product/panel/runtime state，会污染产品 contract，也会让非产品 workstream 无法复用统一执行入口 | — Accepted on 2026-04-23 |
| `apps/app-api`、`apps/public-chat-web`、`apps/protected-panel-web` 的后续验收 / 硬化必须作为单条 `shared product surfaces` workstream 推进，固定顺序为 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance` | 三者共享同一 product backend seam 与 request projection ownership；如果拆成三个并发 workstream，容易把 backend seam defect 错判成 surface 局部问题，并继续积累局部 patch | — Accepted on 2026-04-18 |
| `public-chat-web` 的 end-user auth shell productization、forgot/reset password、mailer contract 与 browser smoke 必须作为 `shared product surfaces acceptance / hardening` 的后续 phases 推进，而不是拆成独立 workstream | 这些层仍属于 shared `app-api + public-chat-web` 的同一产品面；如果另起一条 auth workstream，会把已有 product surface closeout 和 auth follow-up 人为割裂 | — Accepted on 2026-04-19 |
| public auth family 的 abuse-control posture 固定为 always-on Turnstile verification，interactive challenge 只在 elevated risk 时由 Cloudflare managed posture 自适应提升；repo 不自建手动 attack-mode 开关 | 这样可以把 human verification 保持为单一路径 auth admission hardening，而不是把 challenge policy 分叉成 repo-owned 运维开关、环境级双逻辑或 page-level patch | — Accepted on 2026-04-19 |
| `authenticated_notice_portal` 的 live portal scheduling、repo-native collector runtime 与 authenticated control-plane 必须作为单条 deferred workstream 推进，恢复后固定顺序为 `collector runtime/repo migration truth refresh -> auth bootstrap/live capture policy/scheduling -> run ledger/artifact refs/auth readiness -> live-historical reconcile -> operator control-plane/bounded APIs -> planning closeout` | 这些层共享同一 authenticated source-channel truth；如果拆成 collector、auth-window、control-plane、`file_release` live capture 多条 lane，容易把 source-channel 欠账误塞回 downstream regulation 线，或让 live capture 与 historical replay 长期维持两套 truth | — Accepted on 2026-04-19 |
| operator observability 的 app-owned read model、panel 新域与 sink participation 必须作为单条 deferred workstream 推进，恢复后固定顺序为 `request-scoped observability foundation -> audit projection -> metric rollup/APIs -> panel domain expansion -> sink participation/grading backflow -> planning closeout` | 这些层共享同一 app-owned operator truth；如果拆成 `app-api observability`、`panel domain`、`Sentry/Axiom` 多条 lane，容易让 panel 回退成 sink viewer，或让 read model 长期停在半开状态 | — Accepted on 2026-04-19 |
| restricted collection rollout、public/operator/service surface behavior 与 allow/deny leakage verification 必须作为单条 deferred workstream 推进，恢复后固定顺序为 `authorization/release posture -> restricted collection rollout -> surface behavior -> verification/leakage hardening -> planning closeout` | 这些层共享同一 canonical authz truth、retrieval pre-filter 与 deny-path contract；如果拆成多条 lane，容易出现 release posture 半开、surface 口径漂移或 leakage regression 无人收口 | — Accepted on 2026-04-18 |
| 校内导航的产品恢复、`place_card` / map consumption 与 staging/manual acceptance 必须作为单条 deferred workstream 推进，恢复后固定顺序为 `map-launch preconditions -> place_lookup runtime recovery -> place_card/map consumption -> staging/manual acceptance -> planning closeout` | 这些层共享同一 navigation-agent / app-api / product runtime contract；如果拆成 agent、地图 UI、staging 多条 lane，容易在地图未真正上线或 runtime 仍 fail-close 时提前堆消费层 patch | — Accepted on 2026-04-18 |
| `official_web` 的 source-channel follow-up、`stable_reference` maintenance 与 `fresh_news` / `news_archive` opening 必须作为单条 deferred workstream 推进，恢复后固定顺序为 `source/control-plane -> stable_reference maintenance -> fresh_news -> news_archive -> acceptance closeout` | 这几层共享同一 source-truth、control-plane owner 与 runtime opening contract；如果拆成多条 lane，容易提前重开新闻面、混淆默认 surface，或把 control-plane 欠账误转成 retrieval/panel 局部 patch | — Accepted on 2026-04-18 |
| bounded campus agentic retrieval 必须作为独立 workstream 推进，固定顺序为 `typed retrieval plan -> planner/executor multi-step kernel -> freshness/live/source-trust gate -> query activity/evidence/observability -> eval/runtime closeout` | 这些层共享同一 `rag-agent + retrieval-core + runtime gate` truth；如果拆成 contract、executor、live branch 多条 lane，容易留下半 agentic、半 hidden-prompt 的腐烂状态，或把 general-web fallback 混回 campus retrieval 主路径 | — Accepted on 2026-04-21 |
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
| stable-reference-like official-web serving semantics 由 repo helper 统一表达，并同时覆盖 mixed bridge 与 `stable_reference` split scope | 这能避免 retrieval / agent / eval 继续把参考页逻辑绑死在 `muc_public_pages`，同时不把 `fresh_news` / `news_archive` 混进当前说明型 surface | — Validated on 2026-04-05 |
| `official_web/stable_reference` 的 serving alias 在 split-scope qrels/live gate 通过后单独发布，而 `muc_public_pages` 的陈旧 mixed alias 直接撤下 | 这能让当前 worktree-local query-facing official-web surface 与真实可消费 collection 对齐，同时避免继续把 mixed bridge 冒充成长期 serving surface | — Validated on 2026-04-05 |
| `official_web/fresh_news` seed import/release 允许在本地验证阶段使用 injected registry path，只要真实对象存储、真实 Qdrant、repo-tracked manifest/qrels/live gate 全部成立 | 这能在 shared Postgres pooler 短时饱和时继续验证 chunk/index/retrieval 质量，而不把一次本地基础设施波动误写成语料或 runtime 设计 blocker | — Validated on 2026-04-05 |
| `official_web` 新闻面后续 opening execution / acceptance 当前下调为 backlog `999.4`，不再作为当前分支的邻近执行线 | repo-level opening policy/runtime gate 已在 Phase 1003 冻结，继续推进真实 opening 只会占用当前主链路注意力；在产品需要恢复前，更合理的状态是显式 deferred，而不是隐性待做 | — Accepted on 2026-04-14 |

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
*Last updated: 2026-04-19 after migrating planning truth to native GSD workstreams, introducing `.planning/WORKSTREAMS.md`, and archiving the old flat planning files under `.planning/legacy-flat/`*
