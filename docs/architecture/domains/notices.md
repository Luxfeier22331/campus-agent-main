---
doc_type: architecture
owner_boundary: domains/notices
status: active
---
# 通知

## 边界

通知领域接收时效性较强、结构不稳定的校园公告及附件。当前来源只有内部门户通知与内部门户
文件发布。它们都是离线来源，不是在线通知读模型或模型可见工具。

## 来源链路

```text
来源系统
-> source-collector
-> 来源对象
-> 明确的领域物化或发布任务
-> 所属领域读模型
```

来源产物保留通知标识、正文、附件 metadata 和来源信息，但不会自动创建规范规章、校历事件或知识索引。
下游领域必须通过自己的校验和发布入口消费通知：

- 稳定制度正文可以经过显式提升进入规章领域；
- 已核对的日期安排可以成为校历参考数据；
- 没有下游发布器的通知只保留为离线来源产物。

## 在线状态

`campus_notices/internal_notice` 当前不在查询目标注册表中。在线回答不能扫描原始通知、对象
存储或来源数据库，也不能把通知分类配置视为产品能力。

## 相关文档

- `../../data/internal-portal.md`
- `../../contracts/internal-portal-file-release.md`
- `../../decisions/adr-0024-authenticated-notice.md`
