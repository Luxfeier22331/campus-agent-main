---
doc_type: index
status: active
created: 2026-04-19
updated: 2026-04-24
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
| `handbook curriculum MinerU cutover` | `handbook-curriculum-mineru-cutover` | `yes` | `.planning/workstreams/handbook-curriculum-mineru-cutover/README.md` | `Phase 2` | `student_rules` 与 `curriculum_plan` 的 runtime profile 已指向 MinerU；当前补齐 handbook source-truth hard gate、对齐测试/runbook/reference，到位后再进入 shadow rebuild 与 alias cutover |
| `document site and canonical reader` | `document-site-and-canonical-reader` | `yes` | `.planning/workstreams/document-site-and-canonical-reader/README.md` | `Phase 2` | 正式 `public-docs` app 已提升为 docs shell；当前继续收口 published reader assets、runtime-backed `app-api` docs seams 与 shell consumption truth，避免 docs app 继续停留在直接同步公开产物的过渡实现 |
| `authenticated-notice -> regulation downstream consumption` | `authenticated-notice-regulation-consumption` | `yes` | `.planning/workstreams/authenticated-notice-regulation-consumption/README.md` | `Phase 7` | 已完成 `institutional_rules` / `scoped_rules` 的 target-side chunk-prep parity；当前进入 `11` 条 admitted target acceptance rerun 与 gap closure，随后冻结 acceptance evidence |
| `notice consumption layer` | `notice-consumption-layer` | `yes` | `.planning/workstreams/notice-consumption-layer/README.md` | `Phase 6` | `Phase 1-5` 的 semantic modeling 已完成，但 implementation closeout 判断被证实过早；当前重开为 active lane，补 notice consumption projection store，并把 internal notice 的 regulation/scoped downstream consumer 改成经由该 projection 过滤 |
| `repo-wide codebase decomposition` | `repo-wide-codebase-decomposition` | `yes` | `.planning/workstreams/repo-wide-codebase-decomposition/README.md` | `Phase 10` | reopened decomposition inventory 当前 admission 了 `internal_notice_regulation_materialization.py`、`tests/ingestion/test_curriculum_provider_normalize.py` 与 `tests/test_public_docs_sync.py`；`pnpm decomposition:lint` 继续作为 canonical gate，后续必须回到独立 split phase 收口 |
| `eval` | `eval` | `yes` | `.planning/workstreams/eval/README.md` | `Phase 5` | `Phase 1-4` 已完成 shared runtime / artifact / publish / automation 收口；当前仅剩 `golden dataset` 与 shared case governance，继续等待采集内容补全后启动 |
| `curriculum course-map multimodal probe` | `curriculum-course-map-multimodal-probe` | `yes` | `.planning/workstreams/curriculum-course-map-multimodal-probe/README.md` | `Phase 4` | `chat_completions + gpt-5.4` 已完成 fixed sample-set `1-run + 3-run` live rerun，当前 admission 为 `bounded_candidate_for_follow_up`；产品面仍 fail-close，等待 follow-up routing 明确 |
| `go-shell` | `go-shell` | `yes` | `.planning/workstreams/go-shell/README.md` | `Phase 4/5 implementation` | Go shell / Python bridge / auth-admission parity / Docker harness 已落地；当前收口 client disconnect cancellation semantics、metrics-readiness truth 与 cutover/runback |

## Completed

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `execution capability family convergence` | `execution-capability-family-convergence` | `yes` | `docs/plans/archive/completed/execution-capability-family-convergence.md` | 只有在 repo 重新 admission raw runtime target family rename、显式改写 `selected_target` / `selectedTarget` 语义，或新增 capability family 需要重开 repo-wide naming / label convergence 规则时才恢复 |
| `bounded agentic retrieval productization` | `bounded-agentic-retrieval-productization` | `yes` | `docs/plans/archive/completed/bounded-agentic-retrieval-productization.md` | 只有在 repo 重新 admission 新的 retrieval step / planner-executor lifecycle、某个具体产品面决定正式消费 generic `live_source_lookup`、显式改写 raw retrieved trace / supporting evidence / operator observability contract，或把 non-current runtime acceptance 提升为 retrieval owner 时才恢复 |
| `operator observability / control-plane` | `operator-observability-control-plane` | `yes` | `docs/plans/archive/completed/operator-observability-control-plane-foundation.md` | 只有在 repo 重新 admission 新的 operator observability domain、显式改写 `app-api` owned operator truth / sink participation contract，或 panel 需要从 read-only observability control-plane 扩成新的 write/action surface 时才恢复 |
| `shared product surfaces acceptance / hardening` | `shared-product-surfaces-acceptance-hardening` | `yes` | `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md` | 只有在 public auth family / same-site auth contract / Turnstile posture 被显式改写、public browser answer contract 再次出现 raw agent locator 泄漏或 curriculum semester chunk-boundary corruption，或 shared `app-api + public-chat-web + protected-panel-web` 联合验收被重新 admission 为 active hardening 时才恢复 |
| `shared file asset loader contract` | `shared-file-asset-loader-contract` | `yes` | `docs/plans/archive/completed/shared-file-asset-loader-contract.md` | 只有在新的 admitted file asset family 被提升为 active、当前 canonical parser/normalization lane 被显式改写，或 deferred cross-scope adoption 被重新 admission 为 active implementation 时才恢复 |
| `product-path safety / prompt / grounding governance` | `product-path-safety-prompt-grounding-governance` | `yes` | `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md` | 只有 future product scope 扩到 open-ended public input，或重新引入 state-changing / externally side-effectful action execution，并命中 `.planning/seeds/SEED-001-conditional-moderation-lane.md` / `.planning/seeds/SEED-002-conditional-hitl-approval-recovery.md` 的 trigger 条件时才恢复 |
| `campus services offline preparation hardening` | `campus-services-offline-preparation-hardening` | `yes` | `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md` | 只有在产品范围重新提升 `campus_services/*` offline-preparation quality hardening 优先级，或明确 admission 新的 bounded target 时才恢复 |
| `campus services / notices runtime admission` | `campus-services-notices-runtime-admission` | `yes` | `docs/plans/archive/completed/campus-services-notices-runtime-admission.md` | 只有在产品范围重新 admission 新的 runtime capability family、显式改写首发/后续 tool 边界，或需要重开 service / notice / contact / process runtime opening truth 时才恢复 |
| `authenticated-notice file_release owner recovery` | `authenticated-notice-file-release-owner-recovery` | `yes` | `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md` | 只有在新的显式 non-excluded target 被 admission、认证窗口重新可用且产品范围重新恢复 bounded owner recovery 优先级时才恢复 |
| `versioned history query foundation` | `versioned-history-query-foundation` | `yes` | `docs/plans/archive/completed/versioned-history-query-foundation.md` | 只有在 repo 重新 admission runtime-facing non-current query route contract、`app-api` live benchmark 正式承载 non-current `version_query`、或显式改写 `current / historical / as_of / compare` 的 request / resolution / retrieval / answer / eval truth 时才恢复 |
| `repo-wide agent harness rollout` | `repo-wide-agent-harness-rollout` | `yes` | `.planning/workstreams/repo-wide-agent-harness-rollout/README.md` | 只有在 repo 重新 admission 非-Codex adapter implementation、显式改写 terminal-result transport / blocker taxonomy / hook contract，或需要再次调整默认 execution entrypoint 时才恢复 |

## Deferred

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `curriculum course-map docs presentation refinement` | `curriculum-course-map-docs-presentation-refinement` | `yes` | `.planning/workstreams/curriculum-course-map-docs-presentation-refinement/README.md` | 当前 docs 课程地图展示可先保留 baseline；当产品范围决定继续打磨课程地图在文档站中的真实显示效果时恢复 |
| `authenticated-notice live portal / authenticated control-plane` | `authenticated-notice-live-portal-control-plane` | `yes` | `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md` | 只有在认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane 时才恢复 |
| `restricted document rollout / verification` | `restricted-document-rollout-verification` | `yes` | `.planning/workstreams/restricted-document-rollout-verification/README.md` | 只有在产品范围决定打开 restricted surface 或推进 restricted collection rollout 时才恢复 |

## Backlog

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `official-web source channel / news opening` | `official-web-source-channel-news-opening` | `no` | `docs/plans/archive/historical/official-web-source-channel-news-opening.md` | 只有在产品范围重新提升新闻面 opening 优先级后才恢复 |
| `campus navigation rollout / place_card / map consumption` | `campus-navigation-rollout-map-consumption` | `no` | `docs/plans/archive/historical/campus-navigation-rollout-map-consumption.md` | 等待校园地图实际上线后再恢复 |
| `wechat official-account public source channel` | `wechat-official-account-public-source-channel` | `no` | `docs/plans/archive/historical/wechat-official-account-public-source-channel.md` | 只有在产品范围显式 admission 校园公众号公开内容采集，且 `notice` / `official_web` downstream consumption 已准备好时才恢复 |
| `internal-notice procurement notice classification` | `internal-notice-procurement-publication-history` | `yes` | `.planning/workstreams/internal-notice-procurement-publication-history/README.md` | 只有在产品范围显式 admission 为 restricted notice / publication storage 新增稳定 `procurement_notice` 分类，或基于该分类继续做历史查询时才恢复 |
| `chat capacity and cancellation hardening` | `chat-capacity-and-cancellation-hardening` | `yes` | `.planning/workstreams/chat-capacity-and-cancellation-hardening/README.md` | 只有在产品范围决定为 public chat 正式收口 100 人同时提问、热点削峰、ChatGPT 式提交/中止体验或 K8s/多实例容量治理时恢复 |
| `supervisor Docker runtime language split` | `supervisor-docker-runtime-language-split` | `yes` | `.planning/workstreams/supervisor-docker-runtime-language-split/README.md` | 只有在 Docker 侧性能预算、服务器成本或 profiling 结果显示 Python execution shell / CPU-heavy kernel 成为正式迁移瓶颈时恢复 |

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
