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
- 阅读器和知识搜索默认只使用当前已发布版本；
- 只有用户明确询问历史或比较时，Knowledge Agent 才能搜索已经发布且允许访问的历史版本；
- 历史搜索不承诺根据任意日期自动解析唯一版本；
- 比较问题可以通过多次有界搜索完成，回答依据必须保留版本信息；
- 保留来源版本不会自动发布阅读器资产、检索索引或查询目标。

精确历史模式和版本字段由知识工具与文档阅读器合同维护。

## 后果

- 历史内容不会参与默认当前事实回答；
- 使用历史依据时，答案必须说明其不是当前版本；
- 等价来源副本不能被展示为相互独立的佐证；
- 确定的任意日期版本解析需要单独合同和决策。

## 相关文档

- `docs/architecture/system/retrieval-serving.md`
- `docs/decisions/adr-0075-knowledge-search.md`
- `docs/data/document-reader.md`
