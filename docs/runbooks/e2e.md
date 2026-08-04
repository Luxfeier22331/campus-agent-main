---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 发布前 E2E 验收

## 边界

本文说明如何根据发布变更选择并执行 staging 真实用户路径。它不维护固定的全产品清单，也不
替代 PR 测试、环境 rollout、离线评测或 production 审批。

浏览器业务 E2E、真实 staging 登录和 `chat-staging` 不在 GitHub Actions 中自动运行。它们需要
一次性测试账号和即时 Turnstile token，由发布执行者在受控本地终端按本文验收；CI 只验证候选
制品和发布合同。

环境地址、测试身份、Secret 和本次结果由环境仓及发布记录维护，不提交到源码仓。

## 前置条件

开始前确认：

- 目标源码和不可变候选物已经由环境仓选择；
- 环境控制器、数据库变更和运行时就绪检查已完成；
- 执行者拥有本次路径所需的测试身份和观测权限；
- 本次变更影响的产品合同、页面和失败路径已经明确。

前置条件缺失时记录环境阻塞，不通过重新发布无关源码规避。

## 选择用户路径

从变更实际穿过的边界反向选择最小完整路径：

1. 找到用户入口及其所属产品文档；
2. 列出请求经过的 Worker、App API、执行运行时、工具或数据服务；
3. 选择一个成功路径和与本次变化直接相关的失败路径；
4. 涉及认证、权限、恢复、移动端或辅助功能时加入对应变体；
5. 只在可观测性、评测或数据发布发生变化时追加相应专项检查。

不能因为某领域存在就每次执行其全部路径，也不能只验证底层接口而省略用户入口。

## 执行顺序

### 1. 确认环境版本

按环境仓操作手册确认目标 revision、运行版本和就绪状态一致。健康或就绪检查只证明各自职责，
不代替后续用户路径。

### 2. 执行真实旅途

使用部署后的 URL、正式认证方式和环境选择的数据完成用户任务。已有 smoke profile 或 Playwright
项目时使用模块维护的入口；具体命令以根 `package.json`、应用 README 和测试配置为准。

execution 或 App API 变化部署完成后，人工执行正式认证路径：

```bash
pnpm smoke:app-api -- chat-staging \
  --email '<test-account>' \
  --password '<temporary-password>' \
  --captcha-token '<fresh-turnstile-token>'
```

测试账号由环境所有者提供，密码只在本次受控终端会话中使用。Turnstile token 必须在执行前即时取得，
五分钟内单次使用；不得把账号密码或 token 保存为 GitHub Environment Secret、Worker Secret 或 GitOps
配置。该入口通过产品的 email/password 和 Turnstile 登录取得 session，不使用 Cloudflare service
token、内部 smoke endpoint 或认证旁路。

至少确认：

- 用户操作到达预期终态，刷新、恢复或重试行为符合合同；
- 页面在受影响 viewport 中没有遮挡、溢出或不可达操作；
- loading、empty、error 和权限状态可理解；
- console 和关键网络请求没有未解释错误；
- 失败路径不会静默成功、泄露受限内容或切换到未声明的 fallback。

### 3. 关联运行记录

记录请求、运行或 trace 的安全关联标识，并在本次变化涉及的观测系统中确认各阶段可定位。不得
为了方便排查把认证材料、Secret 或未准入正文写入普通日志。

### 4. 检查数据一致性

涉及发布数据、文档或检索目标时，确认用户入口与后端读取同一个已选择版本。缺少可选数据应只
影响所属能力，不能用占位内容伪装成功，也不应使无关产品路径失效。

## 结果记录

发布记录至少包含：

- 源码版本和环境 revision；
- 实际执行的用户路径、命令及结果；
- 检查的失败路径；
- 用于定位的安全关联标识；
- 明确省略的路径及原因。

失败时定位最先失败的组件，在对应仓库或模块修复，并重新执行受影响路径。不要重跑无关发布、
放宽断言或直接修改集群来制造通过结果。

## 相关文档

- `docs/reference/verification.md`
- `docs/environment/readiness.md`
- `docs/runbooks/release.md`
- `docs/runbooks/otel.md`
- `apps/campus-web/README.md`
