---
doc_type: architecture
owner_boundary: domains/regulations
status: active
---

# 规章

## 边界

规章领域维护适用于较长时间范围的学校制度正文及其版本，不把通知包装、临时安排或来源附件直接
当作规范规章。

`institutional_rules`、`scoped_rules` 和 `student_rules` 继续表示来源所有权与处理策略，但不作为
在线查询范围或独立 collection。公开阅读侧栏使用以下十个主题组织全部文档：

- 学籍与培养；
- 课程与考试；
- 毕业与学位；
- 升学与就业；
- 奖助与评优；
- 纪律与权益；
- 校园生活；
- 教学管理；
- 信息化服务；
- 学校治理。

主题、顺序和文档归属写入 `campus_docs_source.v4`，Campus Web 构建和前端不按标题推断。

## 公开阅读

```text
已核对的规范文档单元与来源清单
-> Campus Web 构建生成 reader、课程图和索引
-> Worker 交付静态文档
```

同一 `campus_docs_source.v4` 及其派生的当前 reader 也由 Docs builder 消费。Campus Web 构建不会直接
更新 Qdrant 或当前索引指针；统一 Campus RAG publisher 需要与显式 Notice 制品一起独立验证并激活新索引。

Internal Portal 可以提供来源材料，但来源清单不会自动成为规章。把通知中的制度正文提升为
`institutional_rules` 需要显式的规范文档物化、来源关联和质量检查；当前没有自动提升实现。

## 查询边界

规章不提供专用模型工具；已发布正文通过统一 `campus_search` 查询。公开阅读发布与检索索引激活
是独立步骤，静态页面发布不表示新正文已进入当前索引。在线请求不能读取原始通知、直接查询历史
reader 或绕过准入查询未发布 collection；模型可使用当前 operation 已开放的网页搜索核验公开校园信息。
找不到足够证据时，助手在正常正文中说明无法确认，不用模型记忆补齐；详见[工具路由](../system/tool-routing.md)。

索引发布和生命周期属于独立检索链路，不由 Campus Web 文档构建触发。publisher 不按
`institutional_rules`、`scoped_rules` 或 `student_rules` 过滤；凡是来源清单列为当前版本的公开
reader 都进入同一个索引。

## 相关文档

- [Agent 的机构知识边界](../system/agentic-retrieval.md)
- [检索服务](../system/retrieval-serving.md)
- [内部门户数据](../../data/internal-portal.md)
- [范围规则](../../../.agents/notes/implemented/architecture/2026-07-16-scoped-rules.md)
- [通知中的规章正文](../../../.agents/notes/implemented/architecture/2026-07-16-regulation-promotion.md)
- [规章标识](../../../.agents/notes/implemented/architecture/2026-07-16-regulation-identity.md)
