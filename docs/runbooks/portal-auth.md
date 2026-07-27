---
doc_type: runbook
owner_boundary: source-collector
status: active
---

# 内部门户认证

## 运行模型

source-collector 只接收原始 `SSO_TGC`。每次通知命令、文件发布 Activity 或认证检查都从该值
建立新的 HTTP 会话。Service Ticket、`JSESSIONID` 和 `nginx` Cookie 只存在于当前进程内存，
不写环境变量、文件、Temporal 载荷、对象存储或数据库。

source-collector 不获取、创建或保存 TGC。TGC 由应用外的人员认证流程取得。

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
非零退出码结束；命令不生成或保存检查结果。

## 部署与轮换

Kubernetes 使用固定 Secret `source-collector-internal-portal-auth` 的 `sso_tgc` key，并以完整卷
投影到 source-collector worker 和认证检查 CronJob。Secret 不是可选依赖；环境仓负责预创建并
投递当前值。当前 Ops Web 不提供替换 TGC 的页面或接口，轮换入口不属于本次采集合同。

完整卷会由 kubelet 更新到运行中的 Pod。轮换后无需重启 worker；下一次命令、Activity 或
CronJob 会读取新值。

## 定期检查

`source-collector-auth-check` CronJob 每 30 分钟运行 `auth:check`：

- `concurrencyPolicy: Forbid`，避免检查重叠；
- Job 和容器不重试；
- 成功或失败由 Job 状态和日志体现；
- 不写业务状态、不触发采集、不自动修改 Secret。

源码仓的 manifest 只能证明期望配置可渲染。环境是否已应用、CronJob 是否按期成功，需要在所属
集群查看控制器、Job 和 Pod 状态。

## 一次性迁移

旧版本曾创建两个 Temporal Schedule：

- `internal-portal-auth-maintenance`
- `internal-portal-notice-publication`

部署包含 `source-collector-auth-check` 的环境 revision 后，环境所有者应通过该环境的 Temporal
UI 或 CLI 删除这两个旧 Schedule。当前代码不再同步或消费它们，不能保留它们继续调用已删除的
workflow。

## 失败处理

- `internal_portal_credential_unavailable`：TGC 缺失、为空或格式错误，替换本地值或固定 Secret；
- `internal_portal_credential_expired`：CAS 未签发 Service Ticket 或返回登录入口，重新取得 TGC；
- `internal_portal_session_expired`：当前命令或 Activity 失败，替换 TGC 后重新显式执行；
- 网络或供应商错误：本次执行失败，检查来源可用性后再执行。

应用不会在业务请求中自动重建会话、重放采集、读取旧凭据或把认证失败伪装成空结果。

## 相关文档

- `ingestion.md`
- `../data/internal-portal.md`
- `../contracts/internal-portal-file-release.md`
