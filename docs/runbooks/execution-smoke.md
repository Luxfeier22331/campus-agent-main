---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---
# 执行链路 Staging Smoke

## 边界

本文验证部署后的产品请求能经过 campus-web、app-api 和私有 execution-control runtime 完成
一次持久回答。它不记录私有 hostname、namespace、Application 名、cluster 命令、固定测试
身份或 secret 值；这些内容由环境仓库与 secret manager 拥有。

smoke 通过只能证明该 revision 的链路可用，不证明答案质量、production readiness 或所有
dependency 已完成独立验收。

## 前置条件

- source revision 已通过环境仓库 pull request 选择；
- 环境仓库记录的 Kubernetes 与 Cloudflare desired state 已 reconcile；
- app-api readiness 能确认 execution runtime 依赖可用；
- staging smoke 所需 credential 已通过本地 secret manager 注入；
- 不把 execution-control internal endpoint 暴露为 public smoke surface。

具体环境 health、rollout、secret 与 Worker version 检查按环境仓库 runbook 执行。

## 执行

使用仓库维护的 durable chat profile：

```bash
pnpm smoke:app-api -- chat-staging
```

该 profile 负责 readiness preflight、认证测试会话、提交 chat request、在连接中断后按 run id
恢复 event stream，并检查终态 run、step、conversation 与 trace correlation。不要绕过 profile
并行操作其测试身份，也不要用同步 transport 或宽松 result kind 代替 durable path。

只有排查具体 owner 时才执行 script 暴露的其他 profile；它们不是本 smoke 的替代品。

## 通过标准

- 命令 exit code 为 0，结构化结果包含 `passed=true`；
- submit 已得到 durable run identity，resume stream 到达完成 event；
- run 与 finalization 为成功终态；
- conversation 中存在与 request 对应的 assistant message；
- knowledge case 的 handoff、内部搜索与 source finalization 可从有界投影关联；
- 不出现 Worker proxy、upstream transport 或 execution runtime unreachable 错误。

输出字段的精确 schema 由 smoke script 与测试拥有，本文不复制完整字段清单。

## 失败处理

1. readiness 未通过时停止，不重建测试身份或继续发送 chat request；
1. 根据 app-api readiness 与 trace/run id 判断失败属于 Worker binding、execution runtime 还是
   其 platform dependency；
1. 环境 desired state 问题在环境仓库修复，source/runtime 代码问题在本仓库修复；
1. 修复后从 readiness 开始重新执行，不通过直接 patch cluster 或 `wrangler deploy` 绕过
   GitOps。

验收摘要附在 release/PR 记录中，本仓库不跟踪 timestamp closeout artifact、截图或环境状态
副本。
