---
doc_type: contract
owner_boundary: apps/app-api
status: active
---
# 评测基准接口

## 边界

`POST /api/internal/evals/chat/requests` 供受信任的评测自动化执行真实 app-api 命令链，
并取得请求、调用链关联标识及安全的执行结果。该接口不面向浏览器，也不绕过
execution-control 或 Agent SDK 循环。

## 认证

必需请求头：

- `content-type: application/json`;
- `x-app-internal-auth` matching `APP_API_INTERNAL_SHARED_SECRET`;
- `x-eval-user-email`.

可选的 `x-eval-*` 身份请求头可以提供用户标识、姓名、主体类型、专业、项目、年级、角色、
部门、权限组和检索可见范围。非 ASCII 身份值可以使用 `b64:<base64-utf8>`。

## 请求

```json
{
  "prompt": "奖学金如何评定？",
  "requestedTool": "knowledge_query"
}
```

`conversationId` 和 `requestedTool` 可选。`requestedTool` 是唯一受信任的路由提示，必须
通过运行时注册表校验。接口拒绝 scope、target、version、corpus、collection 和检索控制参数。

即使强制选择 `knowledge_query`，SDK 仍执行正式 handoff：execution-control 注入当前目标
列表，Knowledge Agent 选择目标，终态处理通过同一产品链路验证依据。

## 响应

成功时返回 `200`、`x-request-id`、`x-trace-id`、正常聊天 `answer` 结构，以及仅供评测
使用的安全 `execution` 投影。该投影可以包含状态、所选工具、`resolvedTargets[]`、终态
答案、来源、观测摘要和调用链标识。

响应不得包含准入请求文本之外的原始提示词、供应商响应、来源正文、检索后端载荷或认证
材料。

## 错误

- 内部认证缺失或无效：`401 service_credential_required`；
- 字段不受支持或请求结构无效：`422 validation_failed`；
- 运行时错误：使用带关联标识的 app-api 通用错误合同。

该接口直接返回命令链关联信息，不调度运维投影排空任务。
