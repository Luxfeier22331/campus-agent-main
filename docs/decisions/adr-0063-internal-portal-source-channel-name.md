---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0063
status: accepted
created: 2026-07-01
updated: 2026-07-13
partially_superseded_by: ADR-0077
supersedes:
  - adr-0024-authenticated-notice-source-channel
---
# ADR-0063 Internal Portal Source Channel Name

## 背景

ADR-0024 接受了登录态内部通知作为一级 source channel，并使用
`authenticated_notice_portal` 作为初始名称。随着同一条 source channel 同时承接
`notice` 与 `file_release` surface，这个名称已经不再准确。

旧名把访问方式 `authenticated` 和其中一个 surface `notice` 写进 source channel，容易让以下概念混淆：

- source channel：内部门户源系统
- source surface：`notice` 或 `file_release`
- downstream collection：`campus_notices/internal_notice` 或
  `authenticated_documents/file_release_source`
- site id：学校 adapter 实例，当前是 `synthetic_internal_portal`

## 决策

canonical source channel 改名为 `internal_portal`。

稳定术语固定为：

- source channel：`internal_portal`
- source surfaces：`notice`、`file_release`
- MUC site id：`synthetic_internal_portal`
- notice capture release schema：`authenticated_notice_capture_release.v1`
- notice export schema：`authenticated_notice_collector_export_v2`
- file-release export schema：`authenticated_notice_file_release_export_v1`
- run ledger table：`ingestion_projection.authenticated_notice_collector_run`
- run lease table：`ingestion_projection.authenticated_notice_collector_lease`

ADR-0077 后续删除了 run ledger、run lease 和 source-specific closeout；上述
两个表名只记录本 ADR 接受时的历史决策。当前仍生效的是 `internal_portal`
source channel 与 `notice` / `file_release` surface 命名。

本 ADR 只 supersede ADR-0024 中的 source-channel 名称。ADR-0024 仍保留“为什么这是一级 source
channel，而不是 `official_web` 或 collector 本地 export 格式”的历史 rationale。

## 结果

新的 runtime artifact、source bucket object key、ingestion-control task input、operator
projection key 与 data-plane record 必须使用 `internal_portal`。

`authenticated_notice_portal` 是 retired historical name。它可以继续出现在旧 ADR 和
migration note 中，但 active code、config、test、runbook 与当前 architecture /
data / contract docs 不得把它作为 live source channel 使用。

不接受 runtime alias。携带 `source_channel=authenticated_notice_portal` 的旧 artifact 提交给新
materializer 时必须 fail closed。如果确实需要 replay 历史 artifact，operator
应执行一次性离线对象存储迁移，同时重写对象前缀和内嵌 `source_channel`
字段，再用新的 object ref admission。

`authenticated_notice_collector_export_v2` 与
`authenticated_notice_file_release_export_v1` 是 artifact schema name。旧 run
ledger / lease table 已由 ADR-0077 退役，不是当前 schema 或兼容接口。

active runtime env、Python module、adapter test description 与 source-collector
文档应使用 internal-portal 语义。旧 `AUTHENTICATED_NOTICE_COLLECTOR_*` env 不作为
runtime alias 保留。
