---
doc_type: data
status: active
created: 2026-03-29
updated: 2026-03-29
---

# App API Official Web Schema

## 文档边界

这份文档冻结 `apps/app-api` 为 `official_web` control plane 引入的逻辑分域、最小表形态与 ownership 规则。

它补充但不替代以下文档：

- `app-api` 基础 schema：`docs/data/app-api-schema.md`
- `official_web` control-plane 架构：`docs/architecture/official-web-control-plane-on-app-api.md`
- `official_web` HTTP contract：`docs/contracts/app-api-official-web-http.md`
- run lifecycle：`docs/contracts/app-api-official-web-run-lifecycle.md`

这份文档不冻结：

- 物理拆库
- 具体托管商
- 对象存储 bucket 细节
- ingestion worker 内部 job schema

## Storage Conclusion

第一版接受：

- 继续使用 repo 共享 Postgres 上由 `app-api` 拥有的逻辑 schema 与同一 migration pipeline
- 新增 `official_web.*` 逻辑分域
- 继续允许 `operator.*` 承接 panel-facing read models

固定 ownership：

- `official_web.*`
  crawl-run control-plane durable truth
- `operator.*`
  panel-facing site/run projections

## Global Rules

- DB 只保存 run ledger、heartbeat、artifact refs、handoff truth 与 operator projections
- retained HTML、provider payload、source-truth rows 保存在对象存储，不保存在这些表里
- site config 仍然是 repo-tracked source config，不迁移进数据库当作真相源
- ingestion execution 仍然由 `apps/ingestion-worker` 拥有，不在这里复制其内部 job schema

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

- unique `(site_id, scheduler_run_key)`
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
- `ingestion_dispatch_status` 只表达 handoff/dispatched 语义，不替代 ingestion worker 的内部 job truth

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

规则：

- 这里记录的是 artifact refs，不是 artifact 内容
- `object_key` 必须可被 ingestion worker 稳定解析与读取

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

- 站点基础配置仍来自 repo-tracked config；projection 只缓存 panel-friendly summary
- 不把数据库变成 source config 的长期真相源

## Forbidden Shapes

以下形态不接受：

- 在 DB 中保存 retained HTML、provider payload 或 chunk 文本
- 把 `official_web.crawl_runs` 当成 ingestion worker 内部 job store
- 让 panel 直接查询 `official_web.run_artifacts` 并把它暴露成对象存储浏览器
- 为 `official_web` 再单独长出另一条 migration pipeline
