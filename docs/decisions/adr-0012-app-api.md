---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0012
status: accepted
---
# ADR-0012 共享 App API

## 背景

Campus Web 需要统一的账户及产品数据。为每个学生产品界面分别提供后端会复制身份、产品写入
和策略。

## 决策

`apps/app-api` 是 Campus Web 的产品后端：

- `apps/campus-web` 拥有公开校园产品体验；
- `apps/app-api` 拥有浏览器认证、身份、会话、产品 API 和产品持久化；
- `apps/execution-control` 拥有持久 Agent 执行，不拥有浏览器或产品状态。

浏览器界面通过已开放的 Worker binding 或配置 origin 调用 app-api，不直接调用
execution-control 或数据库。app-api 可以接纳和观测执行，但不运行第二套 Agent loop。

自托管 Ops Web 不属于产品后端路径；它在 ADR-0080 下拥有独立数据角色和明确列出的运维操作。

## 后果

- 产品身份和写入只有一个后端所有者。
- 新浏览器界面默认不会获得独立产品后端。
- 执行与产品持久化可以独立部署。
- API 和 schema 细节留在 app-api 合同与数据文档中。
