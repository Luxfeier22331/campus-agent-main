---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 运维接口合同

## 边界

本文定义 app-api 仍保留的 `/api/operator/*` 共同授权和敏感数据边界：

- 班车发布由 `transport-ops.md` 维护；
- ingestion task 摘要由 `operator.md` 维护；
- 观测投影由 `observability.md` 维护。

Provider Config 和食堂管理不属于 app-api。它们由 Ops Web 的 `/api/ops/*`、专用数据库角色和
固定资源承载，合同见 `../ops-web.md`。app-api 不提供兼容、代理或 active projection 接口。

## 调用与授权

调用者必须提供已准入的 operator principal。普通用户、未准入服务身份和缺少内部认证的请求
必须失败关闭。接口存在不表示 Ops Web 已提供对应页面。

app-api 不开放通用 operator 代理，不代理 Ops Web、数据库、Temporal、对象存储或观测系统。

## 错误与敏感数据

错误响应复用 `error.md`，不得包含数据库地址、Cookie、Access JWT、供应商密钥或内部共享
Secret。列表和详情不得把查询失败转换为空结果或成功状态。
