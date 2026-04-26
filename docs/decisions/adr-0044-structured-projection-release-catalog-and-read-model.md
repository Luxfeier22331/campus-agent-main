---
doc_type: decision
decision_id: ADR-0044
status: accepted
created: 2026-04-26
updated: 2026-04-27
---
# ADR-0044 Structured Projection Release Catalog And Read Model

## 状态

Accepted on 2026-04-26.

## 背景

`campus_services/transport_schedule` 已经具备从 authenticated notice
consumption projection 到 `campus_services_projection_bundle.v1` 的离线物化路径。

第一版实现把 current projection artifact 写到对象存储，并让 Docker runtime 通过 mounted
readonly file 读取 current bundle。这适合 local smoke 与早期 release 验证，但如果作为长期
runtime consumption 形态，会造成几个问题：

- current 指针隐含在对象 key 或文件替换里，缺少事务性发布语义
- 多实例 runtime 的 current 版本、reload 与回滚不够可观测
- schedule lookup 每次读大 JSON bundle，不适合长期结构化查询
- 新通知持续采集后，数据发布容易被误解成需要重新编译或重建镜像
- Redis / file cache / mounted artifact 容易被误用为 projection truth

这条 ADR 冻结 structured projection 的长期 release catalog 与 online consumption
选型。它先约束 `campus_services/transport_schedule`，后续同类 structured projection
可以复用同一形态，但不得自动把所有 retrieval/index release 都改写成同一表结构。

## 决策

### 决策 1：对象存储保留 immutable release artifact truth

对象存储继续保存不可变 release artifact：

- projection bundle
- release manifest
- validation summary
- rejected-source report

对象存储负责审计、回滚、checksum 校验、离线 replay 与 release artifact retention。
它不再作为长期 online runtime 的唯一 current source。

### 决策 2：PostgreSQL 拥有 structured projection release catalog 与 current pointer

长期 current projection 选择由 PostgreSQL 持久化并通过事务切换。

repo 级语义固定为：

- release catalog 记录已发布的 structured projection release
- current pointer 记录某个 `(corpus, collection)` 当前生效的 release
- current pointer 更新必须在 validation 通过、artifact 写入、typed read model 写入完成后再提交
- 发布失败时 current pointer 不移动，runtime 继续读取上一版 release

最小字段族包括：

- `release_id`
- `corpus`
- `collection`
- `schema_version`
- `artifact_object_key`
- `artifact_checksum`
- `generated_at`
- `published_at`
- `source_notice_ids`
- `counts`
- `validation_status`

### 决策 3：transport schedule online lookup 读取 PG typed read model

`transport_schedule_lookup` 的长期 online consumption 不读 raw notice、不读 OCR
artifact、不扫 source-truth inventory，也不直接解析对象存储中的 current JSON。

长期 read model 至少固定为：

- `transport_schedule_releases`
- `transport_routes`
- `transport_schedule_snapshots`
- `transport_scheduled_departures`
- `transport_service_exceptions`
- `transport_release_notices`

每条业务 row 必须携带 `release_id`，runtime 只读取 current pointer 指向的 release。
历史查询、as-of 查询与回滚必须通过 release id / published time 显式表达，不得复用
current row 做隐式覆盖。

### 决策 4：Redis 只允许作为 cache / invalidation adjunct

Redis 可以用于：

- current release change notification
- 多实例 cache invalidation
- hot lookup cache

Redis 不拥有 release catalog、current pointer、typed read model 或 artifact truth。
Redis 缺失、flush 或重启不得导致 canonical current projection 丢失。

### 决策 5：mounted current JSON 只属于 bootstrap / smoke compatibility

mounted current JSON file 可以继续用于：

- local smoke
- release artifact inspection
- early bootstrap fallback
- Docker runtime 的临时 compatibility path

但它不得被记录为长期 production consumption truth。长期 runtime 应通过
projection-backed internal query service 读取 PG current pointer 与 typed read model。

### 决策 6：发布流程必须是 release transaction

长期发布顺序固定为：

```text
build structured projection release
-> validate
-> write immutable object artifacts
-> write typed read model rows under release_id
-> insert release catalog row
-> transactionally update current pointer
-> notify runtime cache invalidation / reload
```

如果任一步失败，current pointer 不应更新。

## 结果

直接结果如下：

- `campus_services/transport_schedule` 的 current file path 只表示当前实现状态，不代表长期
  架构选型
- schedule tool 的长期数据入口是 PG current release + typed read model
- object storage 与 PG 分层不变：对象 bytes 不迁入 PG，PG 保存 release metadata 与结构化查询视图
- Redis 不进入 truth path
- ingestion worker 负责离线 materialization 与 release publication；supervisor-api 只消费
  current typed read model
- 后续实现必须补齐 release catalog、current pointer、typed read model 与 runtime reload /
  cache invalidation，而不是继续扩展 mounted JSON 作为 production path

## Complements

这项决策 complements：

- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/data/campus-services-transport-schedule-source-truth-schema.md`
- `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`
- `docs/decisions/adr-0043-supervisor-api-docker-first-runtime.md`
