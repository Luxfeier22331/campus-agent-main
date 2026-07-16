---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0014
status: accepted
---
# ADR-0014 文档历史版本

## 背景

保留旧文档版本和允许在线查询旧版本是两种职责。把所有保留版本作为普通检索结果，会
让过期规章与当前事实竞争。

## 决策

- 来源和文档所有者可以保留历史版本。
- reader 和知识界面默认只读取当前已发布版本。
- 只有明确的历史或比较问题，由 Knowledge Agent 发送 `include_history=true` 时，知识
  搜索才包含历史文档。
- `include_history` 只扩大已开放搜索集合，不是确定性的 as-of-date resolver；当前合同
  不承诺任意日期选择。
- 一个 Knowledge Agent run 可以通过多次有界搜索比较版本。返回证据应在可用时保留
  `version_id`，使答案可以区分版本。
- 保留来源版本不代表自动发布 reader 版本、Qdrant point 或 query-serving 能力。

同一逻辑文档版本的等价副本不得被展示为相互独立的佐证。

## 后果

- `include_history=false` 应用 current-version filter。
- 历史答案必须说明证据不是当前版本。
- 未来确定性 as-of resolver 需要新合同和新决策，不能从自由文本 prompt 推断。
- 产品 reader 的版本控制属于文档 reader；知识搜索遵循 ADR-0075。

## 相关文档

- `docs/architecture/system/retrieval-serving.md`
- `docs/decisions/adr-0075-knowledge-search.md`
- `docs/data/document-reader.md`
