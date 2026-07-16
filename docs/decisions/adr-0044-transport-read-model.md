---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0044
status: accepted
---
# ADR-0044 班车读取模型

## 背景

挂载 current JSON 会让时刻表更新依赖文件替换和进程级 reload，还会诱导请求消费者解析
publication artifact，而不是读取一个已发布版本。

## 决策

校园班车时刻表使用一套 PostgreSQL release model：

- `campus_services.transport_releases` 保存 immutable release metadata 和浏览器 status
  projection；
- `campus_services.transport_routes`、`transport_departures` 保存每个 release 的 typed
  tool read model；
- `campus_services.transport_current` 选择 current release。

`jobs/transport-publisher` 校验 publication payload、计算 content hash、写入全部 release row，
并在一个 transaction 中移动 current pointer。相同 release id 不得对应不同内容。

execution-control 读取 current pointer、typed route 和 departure row。app-api 读取同一
current release 中存储的 status projection，供浏览器 endpoint 使用。两个消费者都不在
request time 扫描 notice、object storage 或 retrieval chunk；浏览器也不调用 model-visible
tool。

object storage 可以保存上游 publication process 产生的 archive，但时刻表读取和发布不依赖
它。Redis 和 mounted JSON 都不是事实所有者。

本决策仅适用于 transport，不要求所有结构化领域复用相同 table 或 publication lifecycle。

## 后果

- 更新时刻表不需要部署应用。
- validation 或 publication 失败时，previous current release 保持不变。
- tool 与 browser projection 可以不同，但共享 release identity。
- source URL 随 normalized release 和 changed row 保存；raw notice content 仍属于 notice
  source owner。

## 相关文档

- `docs/domains/transport.md`
- `jobs/transport-publisher/src/publication.ts`
