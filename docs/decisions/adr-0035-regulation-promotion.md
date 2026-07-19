---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0035
status: accepted
---
# ADR-0035 通知中的规章正文

## 背景

内部通知可以发布或附带规章，但通知页面、附件占位和规章正文具有不同身份、生命周期与质量要求。
直接把通知记录写入规章集合会把发布包装误当作制度正文。

## 决策

- 通知领域保留原始通知、附件和来源信息；
- `regulations/institutional_rules` 保存可独立使用的稳定规章正文；
- 内容只能经过显式离线物化从通知进入规章领域；
- 物化必须建立独立于通知标识的规章身份，保留来源通知和附件关联，合并同一规章版本的重复来源，
  并在索引发布前校验规范文档；
- 通知分类只提供候选信号，不能直接发布规章；
- 原始通知在规章物化后继续由通知领域保存。

## 结果

- 通知采集成功不等于规章已经发布；
- 在线规章查询只消费独立发布的规范规章；
- 限时或特定范围规则遵循 ADR-0037，不混入稳定校级规章。

## 相关文档

- `../architecture/domains/regulations.md`
- `adr-0037-scoped-rules.md`
- `adr-0040-regulation-identity.md`
- `../data/internal-portal.md`
