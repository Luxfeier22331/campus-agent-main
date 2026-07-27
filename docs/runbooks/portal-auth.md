---
doc_type: runbook
owner_boundary: source-collector
status: active
---

# 内部门户认证

## 运行模型

source-collector 只接收原始 `SSO_TGC`。每次通知命令、文件发布 Activity 或认证检查都从该值
建立新的 HTTP 会话。Service Ticket、`JSESSIONID` 和 `nginx` Cookie 只存在于当前进程内存，
不持久化到文件、Temporal 载荷、对象存储或数据库。

source-collector 不自行获取、创建或改写 TGC。TGC 由应用外的人员认证流程取得，再由开发者写入
本地 `.env`，或由 Ops Web 写入部署环境的固定 Secret。

## 本地使用

将当前原始值写入未跟踪的 `apps/source-collector/adapters/internal-portal/.env`：

```bash
INTERNAL_PORTAL_SSO_TGC=TGT-...
```

`INTERNAL_PORTAL_SSO_TGC_FILE` 只用于部署环境的 Secret 卷投影。source-collector 不接受完整
Cookie 字符串或 `SSO_TGC=` 前缀，也不允许同时设置直接值和文件。

验证当前值：

```bash
pnpm --filter source-collector auth:check
```

该命令只建立门户会话，不请求通知或文件发布内容。成功由退出码 `0` 表示，失败写错误日志并以
非零退出码结束；这条单次命令不写状态文件。

需要在本地开发期间持续使用当前值时，在前台运行：

```bash
pnpm --filter source-collector auth:keepalive
```

命令启动后立即检查，此后每 30 分钟重新读取 `.env` 再检查，因此直接替换其中的
`INTERNAL_PORTAL_SSO_TGC` 即可。每轮在同目录的 `.auth-status.json` 原子记录：

- `lastAttemptAt`：最近尝试时间；
- `lastSuccessfulAt`：最近一次成功使用时间，没有成功记录时为 `null`；
- `lastOutcome`：`valid`、`credential_rejected` 或 `check_failed`。

该状态文件被 Git 忽略且不包含 TGC。`credential_rejected` 表示门户拒绝当前凭据，
`check_failed` 表示网络或依赖检查失败；两者不能相互推断。

## 部署与轮换

Kubernetes 使用固定 Secret `source-collector-internal-portal-auth` 的 `sso_tgc` key，并以完整卷
投影到 source-collector worker 和认证检查 CronJob。Secret 不是可选依赖；环境仓负责预创建并
投递初始值。

部署后由 Ops Web `/internal-portal` 页面替换该固定 key。服务端只接受原始 TGC，不返回现有值、
摘要或末尾字符，也不能选择其他 Secret、CronJob 或 namespace。写入成功后等待下一次定期检查，
不临时创建 Job。Secret 的 `campus-agent.muc.wiki/tgc-updated-at` annotation 记录本次更新时间；
旧 Secret 没有 annotation 时，页面使用 Secret 创建时间。

完整卷会由 kubelet 更新到运行中的 Pod。轮换后无需重启 worker；下一次命令、Activity 或
CronJob 会读取新值。

## 定期检查

`source-collector-auth-check` CronJob 每 30 分钟运行 `auth:check`：

- `concurrencyPolicy: Forbid`，避免检查重叠；
- 每个 Job 最多运行 120 秒；单次门户检查最多等待 60 秒；
- Job 和容器不重试；
- 成功或失败由 Job 状态和日志体现；
- 不写业务状态、不触发采集、不自动修改 Secret。

Ops Web 展示 Secret 更新时间、最近调度时间、最近一次成功使用时间、最近任务状态，以及当前值
更新后是否出现过成功记录。它不预测 TGC 的过期时间，也不把历史成功表述为当前仍然有效。Secret
或 CronJob 读取失败只使该页面返回 `503`，不影响 Ops Web readiness。

源码仓的 manifest 只能证明期望配置可渲染。环境是否已应用、Secret 是否已创建、CronJob 是否
按期成功，需要在所属集群确认。

## 一次性迁移

旧版本曾创建两个 Temporal Schedule：

- `internal-portal-auth-maintenance`
- `internal-portal-notice-publication`

部署包含 `source-collector-auth-check` 的环境 revision 后，环境所有者应通过该环境的 Temporal
UI 或 CLI 删除这两个旧 Schedule。当前代码不再同步或消费它们，不能保留它们继续调用已删除的
workflow。

## 失败处理

- `internal_portal_credential_unavailable`：TGC 缺失、为空或格式错误，替换本地 `.env` 或通过
  Ops Web 替换固定 Secret；
- `internal_portal_credential_expired`：CAS 未签发 Service Ticket 或返回登录入口，重新取得 TGC；
- `internal_portal_session_expired`：当前命令或 Activity 失败，替换 TGC 后重新显式执行；
- 网络或供应商错误：本次执行失败，检查来源可用性后再执行。

应用不会在业务请求中自动重建会话、重放采集、读取旧凭据或把认证失败伪装成空结果。

## 相关文档

- `ingestion.md`
- `../data/internal-portal.md`
- `../contracts/internal-portal-file-release.md`
