---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0012
status: accepted
---
# ADR-0012 共享 App API

## 背景

Campus Web 和 Operator Console 需要相同的账户及产品数据。为每个浏览器界面分别提供
后端会复制身份、产品写入和策略。

## 决策

`apps/app-api` 是 Cloudflare Worker 浏览器界面的共享产品后端：

- `apps/campus-web` 拥有公开校园产品体验；
- `apps/operator-console-web` 拥有受保护的配置和已开放业务操作 UI；
- `apps/app-api` 拥有浏览器认证、身份、会话、产品 API、产品持久化和 operator API；
- `apps/execution-control` 拥有持久 Agent 执行，不拥有浏览器或产品状态。

浏览器界面通过已开放的 Worker binding 或配置 origin 调用 app-api，不直接调用
execution-control 或数据库。app-api 可以接纳和观测执行，但不运行第二套 Agent loop。

自托管 Ops Web 不属于此共享浏览器后端路径；它在 ADR-0072 下拥有独立诊断边界和明确列出的
固定门户认证操作。

## 后果

- 产品身份和写入只有一个后端所有者。
- 新浏览器界面默认不会获得独立产品后端。
- 执行与产品持久化可以独立部署。
- API 和 schema 细节留在 app-api 合同与数据文档中。
