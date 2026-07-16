---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---
# 发布前 E2E 验收

## 边界

本文是 staging 进入 release decision 前的端到端验收入口。它验证已选择环境 revision 的真实
产品路径，不替代 PR test、环境仓库 rollout、RAG score review 或 production approval。

本文不保存私有 hostname、Application/namespace、测试身份、secret、外部 dataset 名、截图
目录或本轮 closeout 模板。环境输入由环境仓库和 secret manager 拥有，验收结果记录到对应
release/PR/incident。

## 前置条件

- source PR 已合入 `main`，`pr / required` 成功；
- publication workflow 已产生 immutable artifact；
- 环境 pull request 已选择 source SHA、image digest 与 Worker version；
- Argo CD、Terraform 和环境 migration 已在同一 desired revision 上完成；
- 执行者拥有经批准的 staging 测试身份与观测平台访问权限。

缺少以上条件时记录为环境阻塞，不反复修改源码制造新的候选 release。

## 1. 环境健康

按环境仓库 runbook 确认：

- Application 与 rollout 健康；
- public surface health/readiness 正常；
- app-api readiness 中本次产品路径依赖均可用；
- Worker version、runtime release 与环境 desired state 一致；
- 不存在 `CrashLoopBackOff`、`ImagePullBackOff` 或未解释的 `Pending`。

source repo 不直连私有 cluster 绕过环境仓库，也不把 internal runtime 暴露为 public probe。

## 2. Chat 主链

执行：

```bash
pnpm smoke:app-api -- chat-staging
```

按 `execution-smoke.md` 验收 durable submit/resume、终态 run、conversation write、
Knowledge Agent handoff、内部搜索与 source finalization。使用包含证据的问题和无需工具的直接
回答各一例；不得用宽松 matcher 或同步 fallback 代替失败路径。

Memory 或其他专项 profile 只有在本次 release 明确变更对应能力时才追加，命令和通过标准由
owner smoke script 拥有。

## 3. 文档阅读

本次 release 涉及 docs reader、admission 或静态资产时执行：

```bash
pnpm smoke:app-api -- docs-gated-staging
```

至少验证公开 permalink、版本/anchor 跳转、受保护文档 admission、缺失 asset 失败关闭，以及
campus-web 未退化为 generic app-api proxy。

## 4. 浏览器体验

通过真实浏览器检查本次受影响的 campus-web journey：

- 页面在 desktop 与 mobile viewport 无遮挡、溢出或不可达操作；
- auth/session、navigation、loading、empty、error 与 retry state 可理解；
- chat stream、source card、docs reader、map/status 等受影响 surface 能完成主任务；
- console 没有未解释 error，关键 asset 与 API 没有失败请求；
- keyboard、focus、label 与基本 accessibility 行为正常。

本地 Playwright 只能证明本地实现；真实 staging 仍需使用部署后的 URL 与配置。

## 5. 可观测性

按 `worker-otel.md` 和 `otel.md`：

- 用 request/trace id 关联入口、app-api、execution runtime 与已启用 sink；
- 确认 error、stage timing、tool/search 与终态信号足以定位失败阶段；
- 确认禁止正文、auth material 和 credential 未进入 signal；
- telemetry failure 不得被误报成业务成功，也不得靠 Worker 直连 vendor 绕过 Collector。

## 6. 数据能力

只验收本次 release 明确包含且已发布 current/read model 的能力。每项检查：

- source/release identity 可追溯；
- browser/tool 读取同一正式数据事实；
- cache/current pointer 更新符合所属合同；
- 缺少可选领域数据只使该能力 unavailable，不应使 chat、memory、knowledge query 或整个
  deployment readiness 失败。

未发布的 transport、dining、notice 或 Official Web 数据不应通过 placeholder/fallback 伪装为
已完成，也不应无关阻塞本次 release。

## 通过与失败

通过需要：环境健康、受影响产品 journey 成功、关键失败路径失败关闭、trace 可关联，并且本次
release 范围内没有未解释 data/contract mismatch。

失败时：

1. 用 request/trace/run id 定位最先失败的 owner；
1. 区分 source defect、environment desired-state defect、provider incident 与缺失可选数据；
1. 在对应 owner 修复并复用同一验收步骤；
1. 不用重跑无关 release closeout、放宽 assertion、跳过 auth 或直接改 cluster 结束验收。

最终记录 source SHA、environment revision、实际执行命令、结果与明确省略项，不把本地 `.tmp`
文件或外部平台原始导出提交进仓库。
