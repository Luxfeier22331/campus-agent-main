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

`institutional_rules`、`scoped_rules` 和 `student_rules` 继续表示来源所有权与处理策略，但不作为
公开目录分类。公开阅读侧栏使用以下十个主题组织全部文档：

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

主题、顺序和文档归属写入 `campus_docs_source.v3`，Campus Web 构建和前端不按标题推断。

## 公开阅读

```text
已核对的规范文档单元与来源清单
-> Campus Web 构建生成 reader、课程图和索引
-> Worker 交付静态文档
```

当前没有把检索分块发布为 release 与 Qdrant 索引的正式生产者，也没有可准入的发布数据，因此
`student_rules` 和 `institutional_rules` grounding 当前不可用。

公开阅读发布不创建、更新或选择在线知识索引，也不改变查询目标的准入状态。

Internal Portal 可以提供来源材料，但来源清单不会自动成为规章。把通知中的制度正文提升为
`institutional_rules` 需要显式的规范文档物化、来源关联和质量检查；当前任务注册表没有实现该
提升步骤。

## 查询边界

规章不向 Primary Agent 提供文档召回或章节读取工具。公开阅读发布不意味着模型获得访问权限。
在线请求不能读取原始通知、现场抓取官网、查询历史 release、跟随可变 alias，或绕过准入查询未
发布 collection。找不到足够当前证据时必须返回无依据终态，不能使用模型记忆补齐。

范围名称、路由词与逻辑集合的映射由 `configs/runtime/query-serving-targets.v3.json` 维护。索引发布
和生命周期属于独立检索链路，不由 Campus Web 文档构建触发；`scoped_rules` 当前未进入查询目标
注册表。

## 相关文档

- `../system/agentic-retrieval.md`
- `../system/retrieval-serving.md`
- `../../data/internal-portal.md`
- `../../decisions/adr-0035-regulation-promotion.md`
- `../../decisions/adr-0040-regulation-identity.md`
