---
doc_type: index
status: active
created: 2026-04-19
updated: 2026-04-27
---

# Workstreams

`WORKSTREAMS.md` 是 repo 级 workstream registry。
它负责记录哪些 workstreams 当前存在、状态如何、入口文档是什么，以及哪些条目已经落成原生 `.planning/workstreams/<slug>/` 目录。

它不替代每条 workstream 自己的 `STATE.md`、`ROADMAP.md`、`REQUIREMENTS.md`。

## Shared Planning Contract

- `PROJECT.md`
  - repo 级产品范围、关键决策与 merged/worktree truth
- `WORKSTREAMS.md`
  - repo 级 workstream registry；active / deferred / backlog / legacy 的唯一总览
- `.planning/workstreams/<slug>/README.md`
  - native workstream 的人工入口；先解释这条线的边界、状态与应继续查看的 `REQUIREMENTS / ROADMAP / STATE`
- `.planning/workstreams/<slug>/STATE.md`
  - 单条 workstream 的当前状态、current slice、blockers、verification 与 continuity
- `.planning/workstreams/<slug>/ROADMAP.md`
  - 单条 workstream 的固定顺序与 phase 状态
- `.planning/workstreams/<slug>/REQUIREMENTS.md`
  - 单条 workstream 的目标、范围、non-goals 与 success criteria
- `.planning/seeds/`
  - dormant future follow-up；记录 why / trigger / breadcrumbs，供后续 milestone 或新 workstream 恢复时再拾起
- `.planning/runtime/`
  - gitignored 的本地 operator 配置、claim lease、claim history 与 session pointer 辅助状态；不承担 tracked planning truth
- `.planning/legacy-flat/`
  - 迁移前的 flat planning archive；仅保留历史 phase / milestone 参考，不再承载当前执行真相
- `.planning/quick/`、`.planning/todos/`、`.planning/codebase/`、`.planning/research/`
  - 当前继续保持 repo 共享，不按 workstream 拆分

## Active

| Workstream | Slug | Native Dir | Entry | Current Phase | Current Slice |
|------------|------|------------|-------|---------------|---------------|
| `document site and canonical reader` | `document-site-and-canonical-reader` | `yes` | `.planning/workstreams/document-site-and-canonical-reader/README.md` | `Phase 6` | `Phase 6` 已完成 restricted / historical reader handoff 与 gated delivery acceptance 的本地实现；下一步只剩 staging reader asset sync 与 live smoke |
| `eval` | `eval` | `yes` | `.planning/workstreams/eval/README.md` | `Phase 5` | `Phase 1-4` 已完成 shared runtime / artifact / publish / automation 收口；当前仅剩 `golden dataset` 与 shared case governance，继续等待采集内容补全后启动 |

## Completed

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `execution capability family convergence` | `execution-capability-family-convergence` | `yes` | `docs/plans/archive/completed/execution-capability-family-convergence.md` | 只有在 repo 重新 admission raw runtime target family rename、显式改写 `selected_target` / `selectedTarget` 语义，或新增 capability family 需要重开 repo-wide naming / label convergence 规则时才恢复 |
| `handbook curriculum MinerU cutover` | `handbook-curriculum-mineru-cutover` | `yes` | `.planning/workstreams/handbook-curriculum-mineru-cutover/README.md` | 只有在 `student_rules` / `curriculum_plan` 需要重新切换 OCR provider、回滚 serving alias、或重开 Paddle/MinerU source-truth cutover 时才恢复 |
| `bounded agentic retrieval productization` | `bounded-agentic-retrieval-productization` | `yes` | `docs/plans/archive/completed/bounded-agentic-retrieval-productization.md` | 只有在 repo 重新 admission 新的 retrieval step / planner-executor lifecycle、某个具体产品面决定正式消费 generic `live_source_lookup`、显式改写 raw retrieved trace / supporting evidence / operator observability contract，或把 non-current runtime acceptance 提升为 retrieval owner 时才恢复 |
| `operator observability / control-plane` | `operator-observability-control-plane` | `yes` | `docs/plans/archive/completed/operator-observability-control-plane-foundation.md` | 只有在 repo 重新 admission 新的 operator observability domain、显式改写 `app-api` owned operator truth / sink participation contract，或 panel 需要从 read-only observability control-plane 扩成新的 write/action surface 时才恢复 |
| `shared product surfaces acceptance / hardening` | `shared-product-surfaces-acceptance-hardening` | `yes` | `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md` | 只有在 public auth family / same-site auth contract / Turnstile posture 被显式改写、public browser answer contract 再次出现 raw agent locator 泄漏或 curriculum semester chunk-boundary corruption，或 shared `app-api + public-chat-web + protected-panel-web` 联合验收被重新 admission 为 active hardening 时才恢复 |
| `shared file asset loader contract` | `shared-file-asset-loader-contract` | `yes` | `docs/plans/archive/completed/shared-file-asset-loader-contract.md` | 只有在新的 admitted file asset family 被提升为 active、当前 canonical parser/normalization lane 被显式改写，或 deferred cross-scope adoption 被重新 admission 为 active implementation 时才恢复 |
| `product-path safety / prompt / grounding governance` | `product-path-safety-prompt-grounding-governance` | `yes` | `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md` | 只有 future product scope 扩到 open-ended public input，或重新引入 state-changing / externally side-effectful action execution，并命中 `.planning/seeds/SEED-001-conditional-moderation-lane.md` / `.planning/seeds/SEED-002-conditional-hitl-approval-recovery.md` 的 trigger 条件时才恢复 |
| `campus services offline preparation hardening` | `campus-services-offline-preparation-hardening` | `yes` | `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md` | 只有在产品范围重新提升 `campus_services/*` offline-preparation quality hardening 优先级，或明确 admission 新的 bounded target 时才恢复 |
| `campus services / notices runtime admission` | `campus-services-notices-runtime-admission` | `yes` | `docs/plans/archive/completed/campus-services-notices-runtime-admission.md` | 只有在产品范围重新 admission 新的 runtime capability family、显式改写首发/后续 tool 边界，或需要重开 service / notice / contact / process runtime opening truth 时才恢复 |
| `authenticated-notice file_release owner recovery` | `authenticated-notice-file-release-owner-recovery` | `yes` | `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md` | 只有在新的显式 non-excluded target 被 admission、认证窗口重新可用且产品范围重新恢复 bounded owner recovery 优先级时才恢复 |
| `authenticated-notice live portal / authenticated control-plane` | `authenticated-notice-live-portal-control-plane` | `yes` | `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md` | 只有在 authenticated portal policy 改变、认证窗口重新 admission 新 surface、需要产品/API scheduler，而不是 repo-owned collector CLI，或 live capture 与 historical replay 再次出现两套 truth 时恢复 |
| `versioned history query foundation` | `versioned-history-query-foundation` | `yes` | `docs/plans/archive/completed/versioned-history-query-foundation.md` | 只有在 repo 重新 admission runtime-facing non-current query route contract、`app-api` live benchmark 正式承载 non-current `version_query`、或显式改写 `current / historical / as_of / compare` 的 request / resolution / retrieval / answer / eval truth 时才恢复 |
| `wechat official-account public source channel` | `wechat-official-account-public-source-channel` | `yes` | `.planning/workstreams/wechat-official-account-public-source-channel/README.md` | 只有在 repo 重新 admission `wechat_public_notice` runtime opening、显式改写 FeedWe provider contract/retention semantics、或需要把 query-serving gate 从 closed 切到 open 时才恢复 |
| `repo-wide agent harness rollout` | `repo-wide-agent-harness-rollout` | `yes` | `.planning/workstreams/repo-wide-agent-harness-rollout/README.md` | 只有在 repo 重新 admission 非-Codex adapter implementation、显式改写 terminal-result transport / blocker taxonomy / hook contract，或需要再次调整默认 execution entrypoint 时才恢复 |
| `notice consumption layer` | `notice-consumption-layer` | `yes` | `.planning/workstreams/notice-consumption-layer/README.md` | 只有在 repo 重新 admission internal_notice consumption projection schema/route semantics、打开新的 notice-derived downstream target，或发现 projection store/rebuild/operator status truth 与代码漂移时才恢复 |
| `authenticated-notice -> regulation downstream consumption` | `authenticated-notice-regulation-consumption` | `yes` | `.planning/workstreams/authenticated-notice-regulation-consumption/README.md` | 只有在新 admission authenticated-notice regulation target、显式改写 `institutional_rules` / `scoped_rules` 边界，或把 stop point 从 `offline_preparation` 提升到 release / query-serving 时恢复 |
| `curriculum course-map multimodal probe` | `curriculum-course-map-multimodal-probe` | `yes` | `.planning/workstreams/curriculum-course-map-multimodal-probe/README.md` | 只有在课程地图重新 admission 为 RAG/query-serving、source-truth canonical 或新的 multimodal extraction contract 时恢复；单纯 UI/UX 展示打磨走 `curriculum-course-map-docs-presentation-refinement` |
| `go-shell` | `go-shell` | `yes` | `.planning/workstreams/go-shell/README.md` | 只有在 repo 重新 admission 新的 supervisor execution runtime migration slice、显式改写 `supervisor-api -> supervisor-agent-worker` bridge contract、重新打开 Python public supervisor runtime entry，或 profiling 证明 prompt/provider executor 或其他 semantic runtime 成为下一条 Go migration 瓶颈时恢复 |
| `repo-wide codebase decomposition` | `repo-wide-codebase-decomposition` | `yes` | `.planning/workstreams/repo-wide-codebase-decomposition/README.md` | 只有在 repo 重新 admission 新的 tracked handwritten code/test monolith decomposition inventory、`pnpm decomposition:lint` 发现新超阈值 tracked 文件、baseline 出现回流，或已拆文件重新长回阈值外时才恢复 |

## Deferred

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `curriculum course-map docs presentation refinement` | `curriculum-course-map-docs-presentation-refinement` | `yes` | `.planning/workstreams/curriculum-course-map-docs-presentation-refinement/README.md` | 当前 docs 课程地图展示可先保留 baseline；当产品范围决定继续打磨课程地图在文档站中的真实显示效果时恢复 |
| `restricted document rollout / verification` | `restricted-document-rollout-verification` | `yes` | `.planning/workstreams/restricted-document-rollout-verification/README.md` | 只有在产品范围显式决定打开 restricted 用户可见 surface、发布 restricted collection/query serving alias，或推进 authenticated document center / restricted reader / restricted retrieval 到真实用户路径时恢复 |

## Backlog

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `official-web source channel / news opening` | `official-web-source-channel-news-opening` | `no` | `docs/plans/archive/historical/official-web-source-channel-news-opening.md` | 只有在产品范围重新提升新闻面 opening 优先级后才恢复 |
| `campus navigation rollout / place_card / map consumption` | `campus-navigation-rollout-map-consumption` | `no` | `docs/plans/archive/historical/campus-navigation-rollout-map-consumption.md` | 等待校园地图实际上线后再恢复 |
| `internal-notice procurement notice classification` | `internal-notice-procurement-publication-history` | `yes` | `.planning/workstreams/internal-notice-procurement-publication-history/README.md` | 只有在产品范围显式 admission 为 restricted notice / publication storage 新增稳定 `procurement_notice` 分类，或基于该分类继续做历史查询时才恢复 |
| `chat capacity and cancellation hardening` | `chat-capacity-and-cancellation-hardening` | `yes` | `.planning/workstreams/chat-capacity-and-cancellation-hardening/README.md` | 只有在产品范围决定为 public chat 正式收口 100 人同时提问、热点削峰、ChatGPT 式提交/中止体验或 K8s/多实例容量治理时恢复 |
| `public-chat profile memory management UI` | `public-chat-profile-memory-management-ui` | `yes` | `.planning/workstreams/public-chat-profile-memory-management-ui/README.md` | 只有在产品范围决定为 public-chat-web 暴露 end-user profile memory 列表、开关、删除与新增入口时恢复；不得重新打开 `app-api` owned memory truth、authorization semantics 或 serving-surface policy |
| `supervisor Docker runtime language split` | `supervisor-docker-runtime-language-split` | `yes` | `.planning/workstreams/supervisor-docker-runtime-language-split/README.md` | 只有在 Docker 侧性能预算、服务器成本或 profiling 结果显示 Python execution runtime / CPU-heavy kernel 成为正式迁移瓶颈时恢复 |
| `public chat campus services E2E acceptance` | `public-chat-campus-services-e2e-acceptance` | `yes` | `.planning/workstreams/public-chat-campus-services-e2e-acceptance/README.md` | 只有在 product path 准备验证 `campus-services-agent` 从 public/chat 入口到 structured tool 消费的真实用户路径时恢复；不得替代 internal structured query unit/integration tests |

## Legacy / Follow-up References

这些条目继续保留为 repo 级参考，但当前不是原生 workstream：

- `docs/plans/archive/historical/protected-panel-requests-triage-table-redesign.md`
- `docs/plans/archive/superseded/golden-dataset-execution-plan.md`
- `docs/plans/archive/historical/legacy-acl-carrier-compatibility-sunset.md`
- `docs/plans/archive/historical/post-closeout-follow-up-execution-plan.md`

## Usage Rules

- 判断 repo 当前有哪些 workstreams、各自状态如何，先看这里
- 进入 native workstream 时，先打开对应 `.planning/workstreams/<slug>/README.md`
- 判断某条 workstream 的当前切片、blockers、verification，进入对应 `.planning/workstreams/<slug>/STATE.md`
- 判断某条 workstream 的固定顺序，进入对应 `.planning/workstreams/<slug>/ROADMAP.md`
- 判断某条 workstream 的范围、non-goals 与 success criteria，进入对应 `.planning/workstreams/<slug>/REQUIREMENTS.md`
- 判断当前谁认领了某条 workstream、handoff 是否 pending、某个本机会话是否仍持有 lease，使用 `uv run --all-packages python -m scripts.workstream_claim ...`；不要把这些运行时状态补写回 tracked planning 文档
- 需要历史 phase / milestone 叙事时，进入 `.planning/legacy-flat/`
