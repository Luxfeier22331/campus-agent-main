---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0014
status: accepted
---

# ADR-0014 文档历史版本

## 背景

保留旧文档版本和允许在线查询旧版本是两种职责。把所有历史版本作为普通检索结果，会让过期
规章与当前事实竞争。

## 决策

- 来源和文档所有者可以保留历史版本；
- 阅读器可以按明确版本展示已发布历史内容；
- Campus Docs publisher 只把来源清单当前 reader 构建的索引写入
  `campus_docs_serving.current_index`；
- 当前在线 Agent 不消费该索引；历史、截至日期和版本比较问题在当前 Agent 能力中返回无法支持；
- 若未来开放历史检索，必须另行定义精确版本选择、引用呈现和评测合同；
- 保留来源版本不会自动把它加入当前检索索引；只有 `source.json` 选中的当前 reader 进入 publisher。

阅读器的版本字段由文档阅读合同维护；Agent 当前没有历史模式字段。

## 后果

- 历史内容不会进入当前 Campus Docs 索引；
- 未来使用历史依据时，答案必须说明其不是当前版本；
- 等价来源副本不能被展示为相互独立的佐证；
- 确定的任意日期版本解析需要单独合同和决策。

## 相关文档

- `docs/architecture/system/retrieval-serving.md`
- `docs/decisions/adr-0084-agent-knowledge-tools.md`
- `docs/data/document-reader.md`
