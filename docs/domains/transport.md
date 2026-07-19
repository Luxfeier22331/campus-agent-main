---
doc_type: domain
owner_boundary: domains/transport
status: active
---

# 班车时刻表

## 边界

班车领域维护已经校验并发布的校园班车时刻表。它同时支持 Campus Web 状态页面和模型可见只读
工具 `transport_schedule_lookup`，两个消费者读取同一发布版本的不同投影。

班车查询不扫描原始通知、HTML、对象存储或检索分块，也不提供通用校园服务查询、路线规划或
任意日期浏览。

## 发布与消费

`jobs/transport-publisher` 校验发布输入并原子创建不可变版本和当前版本选择。App API 读取面向
浏览器的展示投影，execution-control 读取面向工具的结构化线路与发车信息；状态页面不调用模型
工具，工具也不通过 App API 回环。

更新时刻表只移动当前发布版本，不要求重新部署前端或执行服务。浏览器与工具可以使用不同的
返回结构，但必须共享发布身份和来源。

## 工具行为

`transport_schedule_lookup` 只回答其 schema 允许的班车时刻表问题。工具开放取决于运行注册表、
严格函数 schema、执行实现和当前发布数据；来源、适用时间或选择条件无法确认时必须拒绝查询，
不得回退到通知扫描或通用检索。

精确参数、结果和错误由机器合同维护，本文不复制枚举或字段。

## 来源与失败

当前来源通道是需要认证的校园通知。自动化可以准备待发布输入，但查询代码不解释通知正文；
原始通知继续由通知领域保存，班车领域只保存已经规范化并发布的时刻表事实和来源关联。

发布失败时保持上一个当前版本不变。当前版本缺失或无效时，班车页面和工具分别显示不可用或拒绝
执行；该状态不能使聊天、记忆、知识查询或其他产品能力整体不可用。

## 相关文档

- [班车读取模型决策](../decisions/adr-0044-transport-read-model.md)
- [工具读取合同](../contracts/tool-read-model.md)
- `packages/contracts/schemas/campus-services-tool-contracts.v1.schema.json`
- `packages/contracts/schemas/transport-schedule-status.v1.schema.json`
- `jobs/transport-publisher/README.md`
