---
doc_type: data
truth_scope: data
owner_boundary: shared-postgres/official-web
status: active
created: 2026-03-29
updated: 2026-07-07
---
# Official Web Shared Schema

## 文档边界

这份文档冻结 `official_web` shared Postgres 逻辑分域、最小表形态与 runtime ownership
规则。它是 official-web 数据 schema 的唯一 human canonical 文档；历史路径仍在
`docs/data/app-api/` 下，不表示当前 collector control plane 属于 app-api。

它补充但不替代以下文档：

- `official_web` control-plane
  架构：`docs/architecture/domains/official-web/architecture.md`
- source-channel architecture：`docs/architecture/domains/official-web/architecture.md`
- app-api operator HTTP contract：`docs/contracts/app-api/official-web.md`

这份文档不冻结：

- 物理拆库
- 具体托管商
- 对象存储 bucket 细节
- ingestion-control generic task schema
- `fresh_news` 与未来 historical-news/archive surface 的 rollout/opening posture

## Schema 与实现范围说明

这份文档冻结的是 `official_web` collector run ledger、page observation/freshness、
target workset、operator release-gate ledger 与 operator projection 的逻辑 schema、
ownership 与最小表形态。

判断当前已实现子集时：

- 当前已落地表族与 read-model 以代码、`docs/architecture/current.md` 与
  `docs/architecture/domains/official-web/architecture.md` 为准
- 当前项目执行状态、单轮执行进度与 closeout 证据不在本文维护

## Storage Conclusion

当前接受：

- 继续使用 repo 共享 Postgres 上的 `official_web.*` 逻辑分域
- 继续允许 `operator.*` 承接 panel-facing read models
- 历史 app-api Drizzle migration baseline 可以保留 `official_web.*` schema
  definition，但不得据此恢复 app-api collector write/control-plane route

固定 ownership：

- `apps/ingestion-control` owns collector service admission, crawl-run lifecycle
  writes, heartbeat/finalize, artifact refs, page observations, page freshness,
  target workset resolution, run outbox, and ingestion task admission.
- `apps/app-api` owns operator list/detail query, `operator.*` panel-facing
  site/run projections, stable-reference release-gate operator command ledger,
  and redacted release task projection ingest/read.
- `operator.official_web_release_task_*` ingestion-produced operator-safe
  release task projections

## Global Rules

- DB 只保存 run ledger、heartbeat、artifact refs、ingestion dispatch/execution projection
  state 与 operator projections
- retained HTML、provider payload、source-truth rows 保存在对象存储，不保存在这些表里
- site config 仍然是 repo-tracked source config，不迁移进数据库当作真相源
- ingestion execution 由 `apps/ingestion-control` 拥有，不在这里复制其 generic task schema
- release task truth、Temporal workflow、activity dispatch 与 publish 状态机属于
  `apps/ingestion-control`；app-api 只接收 redacted operator
  projection snapshot

## Schema Code Ownership

当前代码组织：

- `apps/ingestion-control` owns the runtime store that writes `official_web.crawl_runs`,
  `run_heartbeats`, `run_artifacts`, `run_outbox`, `page_observations`,
  `page_freshness`, target attempts and target workset reads.
- `apps/app-api` may keep Drizzle schema exports for `official_web.*` to support
  historical migration baseline, operator projection, target inventory queries and
  release-gate command ledger.
- `apps/app-api` must not expose `/api/official-web/*` collector write routes or
  app-api-owned planner/command services.

Migration posture:

- Existing app-api Drizzle migrations that created `official_web.*` are historical
  shared-database baseline.
- New collector control-plane behavior belongs in `apps/ingestion-control` store
  code and migrations/ensure logic owned by ingestion-control.
- Do not create an app-api compatibility proxy or second app-api command service
  for collector lifecycle.

## `official_web.crawl_runs`

用途：

- crawl-run command-side durable truth

最小列：

- `run_id`
- `site_id`
- `scheduler_run_key`
- `run_intent`
- `trigger_type`
- `source_adapter_version`
- `config_version`
- `crawl_policy_version`
- `status`
- `started_at`
- `last_heartbeat_at` nullable
- `finished_at` nullable
- `host_set_json`
- `seed_set_json`
- `summary_json` nullable
- `terminal_error_code` nullable
- `terminal_error_message` nullable
- `ingestion_dispatch_status`
- `ingestion_dispatched_at` nullable
- `ingestion_dispatch_ref` nullable
- `created_at`
- `updated_at`

最小索引：

- unique `(site_id, scheduler_run_key, run_intent)`
- `(status, started_at desc)`
- `(site_id, started_at desc)`
- `(ingestion_dispatch_status, updated_at desc)`

`status` 第一版允许：

- `accepted`
- `running`
- `completed`
- `completed_with_errors`
- `failed`
- `abandoned`

`ingestion_dispatch_status` 第一版允许：

- `pending`
- `queued`
- `dispatched`
- `ingestion_failed`

规则：

- 这是 crawl-run lifecycle 的 durable truth，runtime writer owner 是
  `apps/ingestion-control`
- `summary_json` 只保存 projection-friendly summary，不保存整份 artifact 内容
- `ingestion_dispatch_status` 只表达 task admission / dispatched 语义，不替代
  ingestion-control 的内部 task truth
- `ingestion_dispatch_ref` 当前保存 ingestion-control task id；字段名是历史
  schema 命名，不表示 official-web 仍有独立 terminal handoff object
- ingestion execution 回调当前允许 `pending -> running -> staged -> promoted/failed`
- `staged` 表示 replay / validator / chunk audit 已完成，但 registry current truth 尚未被
  promote 改写

## `official_web.run_heartbeats`

用途：

- 记录 run 活性与过程计数快照

最小列：

- `heartbeat_id`
- `run_id`
- `sequence`
- `observed_at`
- `counts_json`
- `created_at`

最小索引：

- unique `(run_id, sequence)`
- `(run_id, observed_at desc)`

规则：

- 这是 operator 排障与 abandonment 判定的辅助事实
- 不承担 terminal finalize truth

## `official_web.run_artifacts`

用途：

- 记录 run 关联的 object-storage artifact refs

最小列：

- `artifact_id`
- `run_id`
- `artifact_type`
- `object_key`
- `content_sha256`
- `byte_size` nullable
- `record_count` nullable
- `created_at`

最小索引：

- `(run_id, artifact_type)`
- unique `(run_id, artifact_type, object_key)`

第一版 `artifact_type` 至少允许：

- `crawl_run_manifest`
- `host_summary`
- `url_results`
- `failures`
- `source_truth_bundle`
- `quality_audit`
- `page_observations`

规则：

- 这里记录的是 artifact refs，不是 artifact 内容
- `object_key` 必须可被 ingestion-control 稳定解析与读取

## `official_web.run_outbox`

用途：

- crawl-run lifecycle facts 到 projector / ingestion task admission 的边界

最小列：

- `event_id`
- `run_id`
- `event_type`
- `payload_json`
- `occurred_at`
- `available_at`
- `processed_at` nullable
- `attempt_count`
- `last_error` nullable

最小索引：

- `(processed_at, available_at)`
- `(run_id, occurred_at desc)`

第一版 `event_type` 至少允许：

- `official_web.run.accepted`
- `official_web.run.completed`
- `official_web.run.completed_with_errors`
- `official_web.run.failed`
- `official_web.run.abandoned`

规则：

- projector 与 ingestion task admission 都必须以 `event_id` 幂等消费
- outbox payload 只携带 run identity、site identity、terminal status 与 artifact refs

## `official_web.run_admission_decisions`

用途：

- 记录历史 app-api 对 crawl-run 是否允许继续进入 projection / ingestion / selected-write 的控制面决策
- 为 pre-target-workset 历史 run cleanup 提供显式 ledger，而不是物理删除 source truth

最小列：

- `decision_id`
- `run_id`
- `site_id`
- `decision`
- `reason_code`
- `reason`
- `decided_by`
- `decided_at`
- `evidence_json`
- `created_at`
- `updated_at`

最小索引：

- unique `(run_id)`
- `(site_id, decision, decided_at desc)`

该表只属于历史 schema 演化记录，不再属于当前活跃 runtime contract。

当前代码中：

- `official_web` projection drain 直接基于 `crawl_runs`、`run_outbox` 与 run-level
  dispatch/execution 状态推进
- `apps/app-api` 不再维护独立 cleanup admission ledger
- historical schema rows 不应再被解释为当前运行时依赖

## `official_web.page_observations`

用途：

- durable 记录 collector 上报的 page-level observation
- 为 page freshness state 和 ingestion task admission change-set 提供 historical canonical
  上游事实

最小列：

- `observation_id`
- `run_id`
- `site_id`
- `run_intent`
- `host`
- `requested_url`
- `final_url`
- `normalized_canonical_url`
- `page_family`
- `page_title_normalized`
- `discovery_method`
- `discovered_from_url` nullable
- `raw_asset_id` nullable
- `raw_version_id` nullable
- `http_status` nullable
- `content_type` nullable
- `etag` nullable
- `last_modified` nullable
- `response_body_hash` nullable
- `main_content_hash` nullable
- `fetch_disposition`
- `change_status`
- `last_change_reason`
- `cadence_class`
- `priority_score`
- `next_eligible_fetch_at`
- `observed_at`
- `created_at`

规则：

- `fetch_disposition` 反映 collector 观察到的 fetch 结果，例如 `fetched` / `not_modified` /
  `deleted` / `fetch_failed`
- `change_status` 反映 control plane 依据 freshness truth 计算出的 `new` / `changed` /
  `deleted` / `not_modified` / `fetch_failed`
- `fetch_failed` 主要用于 operator 可见性与 repair backlog，不单独推进 ingestion task
  page change
- 这是 official-web control-plane durable truth，不退回对象存储扫描或 generic
  ingestion task 内部状态

## `official_web.page_freshness`

用途：

- 持有 page/url 级 freshness truth 与下一次抓取资格

最小列：

- `site_id`
- `normalized_canonical_url`
- `host`
- `page_family`
- `page_title_normalized`
- `discovered_from_url` nullable
- `discovery_method`
- `last_fetch_disposition`
- `last_http_status` nullable
- `content_type` nullable
- `etag` nullable
- `last_modified` nullable
- `response_body_hash` nullable
- `main_content_hash` nullable
- `last_seen_at`
- `last_changed_at` nullable
- `last_not_modified_at` nullable
- `cadence_class`
- `priority_score`
- `next_eligible_fetch_at`
- `last_successful_run_id` nullable
- `last_change_reason`
- `created_at`
- `updated_at`

规则：

- `(site_id, normalized_canonical_url)` 是 canonical page identity
- `page_freshness` 是 scheduler / collector 后续拉取动态 workset 的 durable truth
- `last_fetch_disposition` 当前允许 `fetched / not_modified / deleted /
  fetch_failed`
- `new / changed / deleted / not_modified / fetch_failed` 的分类以这里和
  `page_observations` 的组合为准
- `plans:resolve` 会基于 `next_eligible_fetch_at`、`cadence_class` 与
  `last_fetch_disposition` 从这里解析动态 workset

## `official_web.target_release_gates`

用途：

- 记录 `official_web/stable_reference` target inventory preview 的 operator approve/reject
  command ledger
- 为 operator/panel 提供可审计决策记录；不承担 executor claim、retry、publish 或失败状态机

最小列：

- `release_id`
- `inventory_id`
- `job_id`
- `run_id` nullable
- `summary_id` nullable
- `decision`
- `status`
- `publish_alias`
- `decided_by`
- `decided_at`
- `notes` nullable
- `evidence_json`
- `created_at`
- `updated_at`

规则：

- `status` 与 `decision` 在 app-api 中只表达 operator ledger 状态：`approved` 或 `rejected`
- stable-reference target release 默认 `publish_alias = false`
- app-api 不保存 selected-write admission/task truth；contact/service selected-write
  release task 属于 ingestion data plane
- 单 target release import、registry scope chunk preparation、Temporal workflow /
  activity dispatch 与 publish 进度均由 `apps/ingestion-control` 的 release task
  lifecycle 承担
- 若物理 schema 中仍存在历史 `execution_json` / `error_json` 列，它们不再是 forward
  executor contract 的一部分

## `operator.official_web_release_task_projection`

用途：

- panel `Official Web / Release Tasks` 的 canonical read model
- 展示 ingestion-owned release task state machine 的 redacted operator projection
- 不承担 task truth、workflow、activity dispatch 或 publish 状态推进

最小列：

- `task_id`
- `task_type`
- `source_channel`
- `inventory_id`
- `job_id`
- `run_id`
- `selected_write_target` nullable
- `lifecycle_status`
- `latest_stage`
- `input_summary_json`
- `output_summary_json`
- `timeline_json`
- `last_error_code` nullable
- `last_error_message` nullable
- `workflow_id`
- `workflow_run_id` nullable
- `created_at`
- `updated_at`
- `projected_at`
- `producer_version`
- `redaction_version`

最小索引：

- `(inventory_id, projected_at)`
- `(job_id, projected_at)`
- `(run_id, projected_at)`
- `(lifecycle_status, projected_at)`
- `(selected_write_target, projected_at)`

规则：

- `task_id` 是幂等 upsert key
- `input_summary_json` 与 `output_summary_json` 只能保存 redacted summary，不保存
  source object key、bucket、raw HTML、raw body、本地路径、credential 或 stack trace
- `timeline_json` 是 panel-friendly timeline cache；event 级幂等事实写入
  `operator.official_web_release_task_event_projection`
- `lifecycle_status` 第一版按 ingestion release task 状态投影，例如 `queued`、
  `claimed`、`running`、`materialized`、`indexed`、`published`、`failed_retryable`、
  `failed_terminal`
- freshness/staleness 是 query service 从 `projected_at` 派生的 read concern，
  不是 task truth

## `operator.official_web_release_task_event_projection`

用途：

- 保存 release task operator projection timeline 的 event-level read model
- 支持按 task/run 展示状态推进轨迹

最小列：

- `event_id`
- `task_id`
- `inventory_id`
- `job_id`
- `run_id`
- `stage`
- `status`
- `occurred_at`
- `summary`
- `payload_json`
- `projected_at`

最小索引：

- `(task_id, occurred_at)`
- `(run_id, occurred_at)`

规则：

- `event_id` 是幂等写入 key；producer 未提供时由 app-api 从
  `task_id/stage/status/occurred_at/index` 生成 deterministic id
- `payload_json` 只能保存 operator-safe payload summary
- event projection 不能被 panel 或 app-api 用来反推 executor retry/publish 决策

## `operator.official_web_run_projection`

用途：

- panel `Official Web / Crawl Runs` 与 `Run Detail` 的 canonical read model

最小列：

- `run_id`
- `site_id`
- `status`
- `ingestion_dispatch_status`
- `source_adapter_version`
- `config_version`
- `started_at`
- `finished_at` nullable
- `last_heartbeat_at` nullable
- `failure_count`
- `summary_json`
- `artifacts_json`
- `projected_at`

最小索引：

- `(site_id, started_at desc)`
- `(status, started_at desc)`
- `(ingestion_dispatch_status, started_at desc)`

规则：

- `artifacts_json` 是 panel-friendly summary，不是对象存储浏览器替代
- 不直接从对象存储目录实时拼装
- run detail 额外展示的 `pageChangeSummary` 与 `pageChanges` 分别来自 run summary 和
  `official_web.page_observations`，不是额外 projection 表

## `operator.official_web_site_projection`

用途：

- panel `Official Web / Sites` 的 canonical read model

最小列：

- `site_id`
- `display_name`
- `host_roots_json`
- `latest_run_id` nullable
- `latest_run_status` nullable
- `last_success_at` nullable
- `last_failure_at` nullable
- `latest_source_adapter_version` nullable
- `latest_config_version` nullable
- `latest_ingestion_dispatch_status` nullable
- `projected_at`

最小索引：

- `(site_id)`
- `(latest_run_status, projected_at desc)`

规则：

- site detail 中的 `freshnessSummary` 由 `official_web.page_freshness` 即时聚合，不额外物化进
  projection 表
- `recentPageChanges` 从 `official_web.page_observations` 读取，默认包含 `new / changed
  / deleted / fetch_failed`
- 站点基础配置仍来自 repo-tracked config；projection 只缓存 panel-friendly summary
- 不把数据库变成 source config 的长期真相源

## Forbidden Shapes

以下形态不接受：

- 在 DB 中保存 retained HTML、provider payload 或 chunk 文本
- 把 `official_web.crawl_runs` 当成 generic ingestion-control task store
- 恢复 app-api-owned collector command/planner route 或 app-api proxy
- 让 panel 直接查询 `official_web.run_artifacts` 并把它暴露成对象存储浏览器
- 为 `official_web` 再单独长出另一条 migration pipeline
