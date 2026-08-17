---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0086
status: accepted
---

# ADR-0086 产品可用性状态页

## 背景

`campus-web` 中的班车、食堂营业等状态属于校园业务数据。产品还需要一个在学生界面故障时仍可
读取的公共页面，回答第一方产品入口是否可用，而不是公开内部运行组件。

## 决策

- 使用独立的 `status-web` Worker，不把产品可用性页面并入 `campus-web`，以保持独立的读取和
  部署故障边界。
- 同一个 Worker 负责黑盒探测、有限快照和公共页面；当前需求不拆独立 publisher、事件数据库或
  管理后台。
- 公共面只展示校园问答和其他学生服务两个产品级身份。内部服务、域名别名和部署入口不形成额外
  服务行；增加服务必须修改公共合同。
- 探测只读取第一方公开或匿名合同，不读取 PostgreSQL、Langfuse、Ops Web 或原始观测数据，也不
  保存响应正文。
- 快照与环境隔离，过期数据不能继续声明当前正常；历史时间线可以保留。
- 第一版只提供当前状态和有限按日历史，不建立 incident、维护、通知或订阅实体。

## 结果

- 状态页浏览器读取已经发布的独立快照，不依赖 Campus Web 或 App API 才能渲染；
- 公共页面不暴露内部组件名、探测地址、用户内容、模型 trace 或请求标识；
- 环境仓拥有域名、Cron、KV、探测地址和实际流量版本；
- 产品展示与无障碍要求由产品文档维护，字段和状态由可执行合同维护。

## 未采用方案

- **放入 Campus Web**：会共享学生产品的故障域，并与校园业务状态混淆；
- **让 App API 聚合状态**：会让公共读取依赖产品后端和数据库；
- **按内部组件拆服务行**：内部拓扑不是用户可见产品能力；
- **直接查询观测平台**：会暴露不适合公共读取的数据，也不能替代黑盒产品探测；
- **预先建立 incident 模型**：当前没有对应用户流程。

## 相关文档

- `../product/status-web.md`
- `../architecture/system/product-runtime.md`
- `../../packages/contracts/schemas/product-availability-snapshot.v1.schema.json`
