---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 会话只读查询

## 历史会话列表

`GET /api/ops/chat-conversations` 返回按会话聚合的摘要列表；每条记录代表一个会话，运行 request
作为会话轮次的诊断入口。列表支持关键词、用户 ID、状态、失败和时间范围筛选，并使用游标分页。
完整消息继续由详情接口提供。

## 接口与所有权

- 浏览器：`GET /api/ops/chat-conversations/:conversationId`，沿用 Ops 准入。
- App API：`GET /api/internal/admin/chat-conversations/:conversationId`，沿用内部 Bearer token。

App API 拥有会话读取；Ops 转发并使用现有来源链接转换。会话列表只返回摘要，不提供聊天写操作。
返回会话 ID、标题、创建与更新时间、活动请求 ID，以及全部当前保存消息。消息包含 ID、角色、
answer/error 类型、正文、创建时间、父消息 ID、请求关联、产品来源和当前反馈。DTO 由
`packages/contracts/src/chat-conversations.ts` 维护，不返回账号资料、session slots 或模型内部输入。

消息按创建时间、轮次、角色（用户在先）、消息 ID 稳定排序；问答关联依据父消息 ID，不猜测相邻消息。
用户消息缺少请求 ID 时，通过同一会话的 dispatch/user-message 关联读取。来源只消费已保存的
`source_items` 产品投影，不从正文重建引用。反馈只关联同一会话、消息和会话所有者。
会话与消息在一个只读数据库快照内读取；归档不影响读取，软删除或不存在返回 404。

所有响应使用 `no-store`。非法 ID 返回 400，后端不可用显示读取失败；不能替代为空会话。
编辑截断删除的消息不重建；已删除会话不展示旧缓存。现有运行记录的保留与查询行为不变。

## 页面与导航

`/conversations/:conversationId?messageId=...&from=...` 从运行或反馈详情进入。
初次读取或目标改变时定位消息，目标不存在时保留当前会话并提示定位消息不可用。
有请求关联的轮次可以进入运行详情；返回链接保留原筛选、分页、反馈和消息定位。
`from` 只允许站内运行列表、运行详情、反馈列表或会话详情。

页面展示已保存快照，手动刷新保留阅读位置，不订阅实时流。活动请求提供运行详情入口。
首次失败、刷新失败、空会话、目标消息缺失和会话不可用分别展示。
运行、反馈与会话页面共用 Ops 的回答正文和来源组件，来源编号、片段及访问规则保持一致。
