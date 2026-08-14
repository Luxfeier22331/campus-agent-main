---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# 通知接口

## 边界

通知接口向已登录 Campus Web 用户提供规范化通知的只读目录和站内正文。所有响应均使用
`Cache-Control: no-store`；未登录请求返回共享认证错误。字段与校验的可执行来源是
`packages/contracts/src/notices.ts`。

## 列表

`GET /api/notices` 按发布时间倒序返回固定分页的通知，并同时返回领域、门户类型和发布部门筛选项。
发布部门筛选项只包含至少被一条通知引用的组织；同名但 ID 不同的组织保持为独立选项。
查询关键词同时匹配原始标题和清洗后的站内正文；外链通知只匹配标题。列表还支持领域、站内或外链、
门户类型、发布部门、起止日期和页码；起止日期按 `Asia/Shanghai` 的自然日解释，筛选状态由
Campus Web 保存在 URL。

站内条目返回站内详情标识；外链条目返回已验证的 HTTP 或 HTTPS 来源 URL，由 Campus Web 在新标签页
直接打开。列表不抓取或代理外部网页。

## 站内详情

`GET /api/notices/:noticeId` 只返回站内通知，包括原始标题、分类与来源 metadata、清洗后的
`contentHtml`、图片同源 URL 和附件 metadata。附件 metadata 包含服务端按 `notice_annex_id` 即时构造的
`downloadUrl`，指向 `my.muc.edu.cn/comsys-portal-notice-web/download`；浏览器使用用户自己的门户
登录态完成下载。外链通知没有站内详情；不存在或外链的 ID 返回 `404`。

`contentHtml` 只使用共享合同允许的标签和属性，图片来源使用 publisher 写入的
`notice-asset:image:<ordinal>` 占位符。Campus Web 在展示前再次校验完整标签和属性集合，只把能与响应
图片 metadata 对应的占位符改写为同源图片 URL；校验失败时不注入正文。

附件响应只包含序号、名称、媒体类型、字节数和门户 `downloadUrl`。附件字节由门户直接响应，App API
不读取或代理附件对象。

## 图片

`GET /api/notices/:noticeId/images/:ordinal` 只读取属于该站内通知的图片。App API 根据 PostgreSQL 中的
摘要从 derived bucket 读取字节，不向响应暴露摘要、bucket key 或对象存储凭据。图片响应使用记录的
媒体类型，并设置 `nosniff` 与受限 CSP；不存在的通知、序号或对象返回 `404`。

## 非目标

这些接口不提供写入、阅读状态、发布状态、附件字节代理、外链正文抓取、Agent 查询、embedding 或 RAG。
