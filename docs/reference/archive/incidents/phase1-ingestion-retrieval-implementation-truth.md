---
doc_type: reference
truth_scope: ops
owner_boundary: docs/reference/archive/incidents
status: historical
created: 2026-03-27
updated: 2026-04-12
---
# Phase-1 Ingestion / Retrieval Snapshot (Historical)

## 文档边界

本文只保留 Phase 1 ingestion / retrieval 落地后的历史实现快照。

本文回答的是：

- Phase 1 当时到底已经落地了哪些关键实现边界
- 哪些 capability 已经在代码中存在，哪些还没有
- 为什么这份文档现在只能作为历史背景，而不是当前 merged truth

本文不负责：

- 充当当前 accepted architecture
- 充当当前 serving surface 或 runtime truth
- 长期维护逐模块实现细节清单

当前应优先阅读：

- `docs/architecture/current-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/` 中后续 superseding ADR

## Historical Phase-1 Baseline

Phase 1 当时已经固定下来的几条实现边界是：

1. object storage 语义
   - source bucket 不再按旧的 `pdf/`、`ocr/`、`source-truth/` 三棵顶层树组织
   - canonical stage 已收口为：
     - `capture/`
     - `provider/`
     - `source-truth/`
   - derived document artifact 已进入 `{corpus}/documents/{collection}/...` 语义
2. replay / rebuild 输入语义
   - handbook replay 的必需主身份已收口为 `raw_version_id`
   - `REBUILD_PROVIDER_RESPONSE_KEY` 已从运行时接口面移除
3. source-truth normalization
   - handbook / curriculum provider normalize 已共用 shared source-truth core
   - shared core 已覆盖文本归一化、bbox、heading hints、跨页 continuation、HTML table cell/grid extraction 等能力
4. retrieval baseline
   - handbook accepted baseline 已固定为 dense + sparse hybrid
   - collection runtime knobs 已转入 `runtime-profile.json`，不再由单个全局 env 持有
   - query output 已收口为 registry-backed `EvidenceBundle`
5. version service 语义
   - 历史 `version_id` 已保留
   - 默认 query-serving 只消费 current-serving documents
   - 但“用户主动查询历史版本”当时尚未落地
6. fail-closed rebuild
   - replay index release 对缺 registry record / 空 chunk 已显式 fail-closed
7. query audit 最小投影
   - 已保留 `source_doc_ids`、`evidence_source_count`、`follow_up_emitted`、`fail_closed`

## Historical Significance

这份 historical snapshot 的意义是：

- 它记录了仓库从早期 bootstrap 走向 typed source-truth、registry-backed retrieval、runtime-profile 驱动配置的关键转折点
- 它说明当时哪些 ingestion / retrieval 语义已经从临时实现收口成明确代码边界
- 它也说明 Phase 1 当时仍然只是阶段性能力，不应被误读为今天的产品架构或产品拓扑

## Historical Limitations

即使在当时，这份 Phase-1 truth 也不表示：

- 当前产品 topology 已冻结在 Phase-1 形态
- 当前 query-serving surface 仍以 handbook bootstrap 语义为主
- 当前性能、指标或 live collection 数字应继续以这份文档为准

后续真正容易漂移、应该离开稳定入口的信息，包括：

- live Qdrant points count
- 某次 rebuild 的具体 collection 数字
- 某次 benchmark 的瞬时结果

这些内容后来应进入 runbook、planning truth、active reference 或临时证据产物，而不是继续保留在这份历史文档中。

## Superseded By

Phase 1 之后，仓库的当前 truth 已由以下文档接管：

- 当前产品与 runtime truth：`docs/architecture/current-architecture.md`
- retrieval / serving 边界：`docs/architecture/retrieval-serving-architecture.md`
- 更晚期的 identity、authorization、offline data plane 与 agent/supervisor 边界文档

因此本文现在只保留追溯价值，不再作为 active implementation 入口。
