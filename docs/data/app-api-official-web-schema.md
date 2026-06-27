---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-03-29
updated: 2026-05-02
---
# App API Official Web Schema

## 文档边界

这份文档冻结 `apps/app-api` 为 `official_web` control plane 引入的逻辑分域、最小表形态与 ownership
规则。

它补充但不替代以下文档：

- `app-api` 基础 schema：`docs/data/app-api-schema.md`
- `official_web` control-plane
  架构：`docs/architecture/domains/official-web/architecture.md`
- 领域导航：`docs/domains/official-web.md`
- `official_web` HTTP contract：`docs/contracts/app-api-official-web-http.md`
- run lifecycle：`docs/contracts/app-api-official-web-run-lifecycle.md`

这份文档不冻结：

- 物理拆库
- 具体托管商
- 对象存储 bucket 细节
- ingestion-control 内部 task schema
- `fresh_news` / `news_archive` 的 rollout/opening posture

## Schema 与实现范围说明

这份文档冻结的是 `official_web` control-plane 的逻辑 schema、ownership 与最小表形态。

判断当前已实现子集时：

- 当前已落地表族与 read-model 以代码、`docs/architecture/current.md` 与
  `docs/domains/official-web.md` 为准
- 当前项目执行状态、单轮执行进度与 closeout 证据不在本文维护

## Storage Conclusion

第一版接受：

- 继续使用 repo 共享 Postgres 上由 `app-api` 拥有的逻辑 schema 与同一 migration pipeline
- 新增 `official_web.*` 逻辑分域
- 继续允许 `operator.*` 承接 panel-facing read models

固定 ownership：

- `official_web.*` crawl-run control-plane durable truth
- `operator.*` panel-facing site/run projections
- `operator.official_web_release_task_*` ingestion-produced operator-safe
  release task projections

## Global Rules

- DB 只保存 run ledger、heartbeat、artifact refs、handoff truth 与 operator projections
- retained HTML、provider payload、source-truth rows 保存在对象存储，不保存在这些表里
- site config 仍然是 repo-tracked source config，不迁移进数据库当作真相源
- ingestion execution 由 `apps/ingestion-control` 拥有，不在这里复制其内部 task schema
- release task truth、claim、lease、retry、dead-letter 与 publish 状态机属于
  `apps/ingestion-control`；app-api 只接收 redacted operator
  projection snapshot

## Schema Code Ownership

`apps/app-api` 新增的数据库代码组织固定为：

- `official_web.*`
- `operator.*` 下的 `official_web` projections

它们继续共享：

- 一套 Drizzle schema codebase
- 一条 migration pipeline
- 一份 schema 版本历史
- `drizzle.app_api_migrations` 这张 `app-api` 专属 journal table

## `official_web.crawl_runs`

用途：

- crawl-run command-side durable truth

最小列：

- `run_id`
- `site_id`
- `scheduler_run_key`
- `run_intent`
- `trigger_type`
- `collector_version`
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

- 这是 crawl-run lifecycle 的 canonical owner
- `summary_json` 只保存 projection-friendly summary，不保存整份 artifact 内容
- `ingestion_dispatch_status` 只表达 handoff/dispatched 语义，不替代 ingestion-control 的内部
  task truth
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

- crawl-run terminal facts 到 projector / ingestion handoff 的边界

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

- projector 与 ingestion handoff 都必须以 `event_id` 幂等消费
- outbox payload 只携带 run identity、site identity、terminal status 与 artifact refs

## `official_web.run_admission_decisions`

用途：

- 记录 app-api 对 crawl-run 是否允许继续进入 projection / ingestion / selected-write 的控制面决策
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
- 历史 migration artifacts 可以保留，但不应再被解释为当前运行时依赖

## `official_web.page_observations`

用途：

- durable 记录 collector 上报的 page-level observation
- 为 page freshness state 和 ingestion handoff change-set 提供 canonical 上游事实

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
- `change_status` 反映 `app-api` 依据 freshness truth 计算出的 `new` / `changed` /
  `deleted` / `not_modified` / `fetch_failed`
- `fetch_failed` 主要用于 operator 可见性与 repair backlog，不单独推进 ingestion handoff page
  change
- 这是 control-plane durable truth，不退回对象存储扫描或 ingestion-control 内部状态

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
- 单 target release import、registry scope chunk preparation、claim/lease、
  retry/dead-letter 与 publish 进度均由 `apps/ingestion-control` 的 release task
  state machine 承担
- 若物理 schema 中仍存在历史 `execution_json` / `error_json` 列，它们不再是 forward
  executor contract 的一部分

## `operator.official_web_release_task_projection`

用途：

- panel `Official Web / Release Tasks` 的 canonical read model
- 展示 ingestion-owned release task state machine 的 redacted operator projection
- 不承担 task truth、claim、lease、retry、dead-letter 或 publish 状态推进

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
- `attempt_count`
- `max_attempts`
- `input_summary_json`
- `output_summary_json`
- `timeline_json`
- `last_error_code` nullable
- `last_error_message` nullable
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
- `collector_version`
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
- `latest_collector_version` nullable
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
- 把 `official_web.crawl_runs` 当成 ingestion-control 内部 task store
- 让 panel 直接查询 `official_web.run_artifacts` 并把它暴露成对象存储浏览器
- 为 `official_web` 再单独长出另一条 migration pipeline
