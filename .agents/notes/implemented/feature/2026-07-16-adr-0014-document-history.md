# Agent Note: ADR-0014 文档历史版本

Status: implemented

## 背景

保留旧文档版本和允许在线查询旧版本是两种职责。把所有历史版本作为普通检索结果，会让过期
规章与当前事实竞争。

## 决策

- 来源和文档所有者可以保留历史版本；
- 阅读器可以按明确版本展示已发布历史内容；
- 统一 Campus RAG publisher 只把来源清单当前 reader 构建的 Docs 制品与显式 Notice 制品组装后写入
  `campus_docs_serving.current_index`；
- 当前在线 Agent 通过只读 `campus_search` 消费该索引；历史、截至日期和版本比较问题在当前 Agent 能力中返回无法支持；
- 若开放历史检索，必须另行定义精确版本选择、引用呈现和评测合同；
- 保留来源版本不会自动把它加入当前检索索引；只有 `source.json` 选中的当前 reader 进入 publisher。

阅读器的版本字段由文档阅读合同维护；Agent 当前没有历史模式字段。

## 未采用方案

- **把保留的全部历史版本加入普通检索**：可以立即扩大历史覆盖，但会让过期规章与当前事实竞争；
  历史查询需要独立的版本选择、引用和评测合同。

## 后果

- 历史内容不会进入当前 Campus Docs 索引；
- 未来使用历史依据时，答案必须说明其不是当前版本；
- 等价来源副本不能被展示为相互独立的佐证；
- 确定的任意日期版本解析需要单独合同和决策。

## 相关文档

- [检索服务](../../../../docs/architecture/system/retrieval-serving.md)
- [ADR-0084 单一 Agent 与机构知识边界](../architecture/2026-07-29-adr-0084-agent-knowledge-tools.md)
- [文档阅读器数据模型](../../../../docs/data/document-reader.md)
