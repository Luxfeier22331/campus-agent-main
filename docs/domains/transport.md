---
doc_type: domain
owner_boundary: domains/transport
status: active
---

# 班车时刻表

## 边界

班车领域读取 PostgreSQL 中已经存在的版本化校园班车时刻表。它同时支持 Campus Web 状态页面和
模型可见只读工具 `transport_schedule_lookup`，两个消费者读取同一当前版本的不同投影。

班车查询不扫描原始通知、HTML、对象存储或检索分块，也不提供通用校园服务查询、路线规划或
任意日期浏览。

## 读取模型与消费

`app-api-schema` 安装 `campus_services` 表并授予读取权限。App API 只读取面向浏览器的当前版本展示
投影，execution-control 读取面向工具的结构化线路与发车信息；状态页面不调用模型工具，工具也不
通过 App API 回环。

当前仓库不提供班车数据写入或发布命令。已有数据和当前版本选择独立于应用部署继续存在；浏览器与
工具可以使用不同的返回结构，但必须共享版本身份和来源。

## 工具行为

`transport_schedule_lookup` 只回答其 schema 允许的班车时刻表问题。工具开放取决于运行注册表、
严格函数 schema、执行实现和当前发布数据；来源、适用时间或选择条件无法确认时必须拒绝查询，
不得回退到通知扫描或通用检索。

精确参数、结果和错误由机器合同维护，本文不复制枚举或字段。

## 来源与失败

查询代码不解释通知正文，原始通知继续由通知领域保存。当前没有从通知生成或更新班车读取模型的
运行链路，`campus_services` 只保存已有的规范化时刻表事实和来源关联。

当前版本缺失或无效时，班车页面和工具分别显示不可用或拒绝执行；该状态不能使聊天、记忆、知识
查询或其他产品能力整体不可用。

## 相关文档

- [班车读取模型决策](../decisions/adr-0044-transport-read-model.md)
- [工具读取合同](../contracts/tool-read-model.md)
- `packages/contracts/schemas/campus-services-tool-contracts.v1.schema.json`
- `packages/contracts/schemas/transport-schedule-status.v1.schema.json`
