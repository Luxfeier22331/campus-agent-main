---
doc_type: architecture
owner_boundary: domains/regulations
status: active
---

# 规章

## 边界

规章领域维护适用于较长时间范围的学校制度正文及其版本，不把通知包装、临时安排或来源附件直接
当作规范规章。

当前在线文档范围包括：

- `student_rules`：面向学生的手册和规章；
- `institutional_rules`：学校层面的稳定制度正文。

`scoped_rules` 用于有明确时间、组织或人群范围的规则配置，目前不在在线查询范围。

## 数据流

```text
已核对的规范文档单元
-> build-retrieval-chunks-v2
-> retrieval_chunk_set.v2

knowledge-serving-release.v1 + PostgreSQL current_releases + Qdrant
-> execution-control grounding 消费接口
```

当前没有把检索分块发布为 release 与 Qdrant 索引的正式生产者，也没有可准入的发布数据，因此
`student_rules` 和 `institutional_rules` grounding 当前不可用。

Internal Portal 可以提供来源材料，但来源清单不会自动成为规章。把通知中的制度正文提升为
`institutional_rules` 需要显式的规范文档物化、来源关联和质量检查；当前任务注册表没有实现该
提升步骤。

## 查询边界

规章不向 Primary Agent 提供文档召回或章节读取工具。execution-control 在模型调用前从已准入的
冻结问题命中相应范围时，execution-control 才从当前 release 并发召回 chunk，使用 Qdrant RRF 分数排序，并把有界
依据写入 `grounding_context.v2`。

在线请求不能读取原始通知、现场抓取官网、查询历史 release、跟随可变 alias，或绕过准入查询未
发布 collection。找不到足够当前证据时必须返回无依据终态，不能使用模型记忆补齐。

范围名称、路由词与逻辑集合的映射由 `configs/runtime/query-serving-targets.v3.json` 维护，具体分块、检索
和索引配置由各集合目录维护。

## 相关文档

- `../system/agentic-retrieval.md`
- `../system/retrieval-serving.md`
- `../../data/internal-portal.md`
- `../../decisions/adr-0035-regulation-promotion.md`
- `../../decisions/adr-0040-regulation-identity.md`
