---
doc_type: runbook
owner_boundary: agent-runtime
status: active
---
# 回答临时传输切换与验收

## 前提

本次采用空闲直接切换。发布前确认没有活跃产品请求、执行中的 Agent Workflow/Activity 或相关后台任务；
不满足时等待空闲，不终止现有执行。各组件切换完成前不发起验收请求。
不增加维护模式、数据库迁移或新凭据，不保留新旧正文双写。

## 发布顺序

1. Source 验证并产出本分支对应的 Control、Runtime 镜像及 Worker 源码候选。
2. GitOps 先更新 Control，确认 `answer/started`、`answer/delta`、`answer/completed` 接口版本到位。
3. 更新 Runtime，确认 Temporal poller 就绪，再完成 App API/Web Worker 切流。
4. 确认实际镜像摘要、Worker 版本均属于本次目标版本后，发起验收对话。

发布使用[既有发布流程](../release/release.md)；不同应用的同步顺序不代表跨应用原子更新。
旧版本 Runtime 不支持本次独立 started 与 answer_index 合同，不能与最终版 Control 混用。
历史数据库正文事件不删除，但不再通过浏览器事件 API 重放。

## 验收

- Runtime 向 Control A 发布，App API 经集群入口从 Control B 读取；两个实例连接相同数据库。
- 正常回答、中文及 emoji 长正文最终完整显示，临时段使用 answerIndex，不推进持久 sequence。
- 浏览器断线后携带两个游标恢复，重复片段不重复追加；读取副本重启后允许缺失草稿，最终正文完整替换。
- 注入临时通知失败时模型仍只执行一次，最终结果与 completed 事件仍保存；取消仍及时生效。
- 查询本次请求的 agent_run_events，确认没有 run.answer_delta，生命周期事件与产品终态仍存在。
- 查看现有日志中的 temporary answer publishing stopped、临时读取错误及流水线和集群健康状态；
  不以构建成功代替真实对话验收。

记录本次发布与测试结果在 PR/部署记录中。缓冲只提供有限补发；不以重新调用模型补齐丢失草稿。

## 本地复现

使用本分支 worktree 的独立本地 profile，先完成 `pnpm dev:init --target core` 与
`pnpm dev:local models seed --name primary_agent`，并安装 Playwright Chromium。
停止该 profile 已有的应用进程，保留 PostgreSQL、Temporal 等基础设施，再执行：

```sh
pnpm --filter campus-web build:fixture
pnpm --filter campus-web test:e2e:answer-transport
ANSWER_TRANSPORT_REAL_PROVIDER=1 pnpm --filter campus-web test:e2e:answer-transport --grep "current real provider"
```

测试启动真实 Runtime/Temporal、两个 Control 副本、Memory API、集群入口与两个 Worker；
默认只替换外部模型响应，并在 Runtime 到 Control 的 HTTP 边界注入临时发布故障。
覆盖正常长答案、浏览器断线、读取副本重启、发布失败；同时查询 PostgreSQL 确认正文不落事件表，
刷新浏览器确认最终答案已持久化。启用真实 provider 的用例使用该 profile 原有模型配置。
测试结束恢复原模型配置并停止自身启动的进程；服务日志位于 `var/dev/answer-transport/`。

## 失败处理

临时增量缺失时检查最终持久答案；若请求未完成，按现有 Runtime 日志定位模型或完成投影错误。
验收失败时保留实际错误，修复后重试，不通过重新生成草稿掩盖失败。

## 相关文档

- [持久运行数据](../../data/durable-runtime.md)
- [对话 API 合同](../../contracts/app-api/chat.md)
