---
doc_type: architecture
owner_boundary: domains/regulations
status: active
---
# 规章

## 边界

规章领域维护适用于较长时间范围的学校制度正文及其版本，不把通知包装、临时安排或来源附件直接
当作规范规章。

当前模型可查询目标为：

- `student_rules`：面向学生的手册和规章；
- `institutional_rules`：学校层面的稳定制度正文。

`scoped_rules` 用于有明确时间、组织或人群范围的规则配置，目前不在查询目标注册表中。

## 数据流

```text
已核对的规范文档单元
-> ingestion-control / Rust 内核校验与分块
-> 索引与 release
-> query-serving target
-> Knowledge Agent
```

Internal Portal 或 Official Web 可以提供来源材料，但来源清单不会自动成为规章。把通知中的制度
正文提升为 `institutional_rules` 需要显式的规范文档物化、来源关联、质量检查和发布；当前任务
注册表没有实现该提升步骤。

## 查询边界

Primary Agent 通过 `knowledge_query` 进入 Knowledge Agent，Knowledge Agent 再使用内部
`knowledge_search` 查询已准入目标。在线请求不能读取原始通知、现场抓取官网或绕过 release 查询
未发布集合。

目标名称与物理集合的映射由 `configs/runtime/query-serving-targets.v1.json` 维护，具体分块、检索
和索引配置由各集合目录维护。

## 相关文档

- `../system/retrieval-serving.md`
- `../../data/internal-portal.md`
- `../../decisions/adr-0035-regulation-promotion.md`
- `../../decisions/adr-0037-scoped-rules.md`
- `../../decisions/adr-0040-regulation-identity.md`
