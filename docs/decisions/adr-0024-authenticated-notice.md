---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0024
status: accepted
---
# ADR-0024 认证通知来源

## 背景

需要认证的校内门户与公开网站具有不同的身份、访问和采集语义。把两者视为同一来源会混合公开
抓取策略与依赖会话的内部采集。

## 决策

- 校内门户使用独立来源通道 `internal_portal`；
- `notice` 与 `file_release` 是两个独立来源类型；
- notice 以门户和通知标识确定来源身份，正文、元数据或附件关系发生实质变化时产生新版本；
- file release 保持自己的来源合同，不转换为 notice；
- `apps/source-collector` 的 internal-portal 适配器负责供应商响应、规范来源块、附件引用和已验证
  附件字节，并通过共享 Temporal 采集 workflow 返回带摘要的来源清单；
- collector 不承担规范文档、OCR、规章物化、分块、索引或查询发布；
- 通知父工作流按采集、物化、校验和离线发布推进，文件发布按精确 ID 提交；
- 固定认证维护计划只验证 TGC 和门户会话，不提交采集任务。验证成功可以恢复因凭据问题自动
  暂停的通知计划，但不能把认证成功解释为采集或在线发布成功。

## 结果

- 内部门户和 Official Web 保持独立采集规则；
- 成功认证和采集不代表通知已经具备在线查询能力；
- 来源字节和完整离线发布清单保存在对象存储，PostgreSQL 只保存有界任务投影、当前发布指针
  和通知检查点；
- 下游规章、班车、校历等领域必须通过自己的校验和发布入口消费通知来源。

## 相关文档

- `../architecture/domains/notices.md`
- `adr-0077-ingestion.md`
- `../architecture/system/data-plane.md`
- `../data/internal-portal.md`
