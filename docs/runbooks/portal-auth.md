---
doc_type: runbook
owner_boundary: source-collector
status: active
---

# 内部门户认证

## 运行模型

source-collector 只接收一个外部门户凭据：原始 `SSO_TGC`。本地或 Kubernetes 运行时通过
`INTERNAL_PORTAL_SSO_TGC_FILE` 指定文件；旧的 `INTERNAL_PORTAL_SSO_TGC`、
`INTERNAL_PORTAL_JSESSIONID` 和 `INTERNAL_PORTAL_NGINX` 环境变量已经退役，配置它们会使
适配器启动失败。

Playwright 使用 TGC 完成浏览器 SSO 并取得 Service Ticket，在
`INTERNAL_PORTAL_RUNTIME_DIR` 中派生 `JSESSIONID`、`nginx` 和 storage state。派生状态只属于
worker 本地；应用会话过期时，单次来源请求只刷新一次并重试一次。

Kubernetes 将固定 Secret `source-collector-internal-portal-auth` 的 `sso_tgc` key 以完整卷
投影给 source-collector。Ops Web 只能读取该 Secret 的配置状态和 patch 该 key，不能创建、
列举、删除或操作其他 Secret。

## 首次部署

环境先创建空的固定 Secret：

```bash
kubectl create secret generic source-collector-internal-portal-auth \
  --namespace "${NAMESPACE}"
```

`ingestion-schedule-sync` PostSync Job 创建固定
`internal-portal-auth-maintenance` Schedule。首次创建时 Schedule 暂停，说明为
`awaiting initial credential`。先确认 ingestion-control、两个 worker、Ops Web 和该暂停
Schedule 正常，再获取真实凭据。

## 获取与校验

在可信人员工作站执行：

```bash
pnpm --filter source-collector auth:save -- --output /tmp/internal-portal-sso-tgc
INTERNAL_PORTAL_SSO_TGC_FILE=/tmp/internal-portal-sso-tgc \
  pnpm --filter source-collector auth:check:notice
INTERNAL_PORTAL_SSO_TGC_FILE=/tmp/internal-portal-sso-tgc \
  pnpm --filter source-collector auth:check:file-release
INTERNAL_PORTAL_SSO_TGC_FILE=/tmp/internal-portal-sso-tgc \
  pnpm --filter source-collector auth:refresh
```

`auth:save` 打开可见浏览器，等待人员完成学校 SSO，只把原始 TGC 以 `0600` 权限写入指定
文件。两个检查命令分别验证通知和文件发布入口；`auth:refresh` 强制取得新的 Service Ticket、
建立门户会话并探测通知接口。命令不得在终端输出凭据。

## 轮换

打开 Ops Web 的 `/internal-portal-auth`。人员可以提交原始 TGC，或只包含一个 `SSO_TGC` 的
Cookie 字符串。服务令牌、跨站请求、多个 TGC、控制字符和超过 8 KiB 的正文都会被拒绝。

更新只替换固定 Secret 的 `sso_tgc`，并记录更新时间和更新人，不读取旧值或保留历史。
Secret 更新成功后，Ops Web 尝试恢复固定 Schedule，但不立即触发工作流；恢复失败不撤销
凭据更新，人员可以在同一页面显式重试恢复。

Secret 使用完整卷而非 `subPath`，因此 kubelet 最终会把新值投影到运行中的 Pod，不要求
重启 worker。投影完成后的下一次维护或采集 activity 读取新文件；已经因凭据失效结束的采集
任务不会自动重跑，需要使用新 task ID 提交。

## 定期维护

Temporal 每 30 分钟运行一次固定维护 workflow。每次运行只从挂载 TGC 开始，丢弃旧派生
会话，重新取得 Service Ticket、建立门户会话并探测一条通知。瞬时网络或供应商错误记录为
`TRANSIENT_FAILURE`，保留后续周期；确认凭据缺失或失效时以不可重试错误结束并暂停
Schedule，等待人员替换凭据。

Ops Web 展示最近维护结果和已观测有效区间。该区间受 30 分钟周期限制，不是供应商有效期
承诺，也不能证明凭据在两次探测之间持续有效。

## 安全与失败处理

- `internal_portal_credential_unavailable`：文件缺失、为空或格式错误；初始化或替换固定 Secret；
- `internal_portal_credential_expired`：浏览器 SSO 返回登录页或未签发 Service Ticket；重新获取并替换 TGC；
- 短暂网络错误：保留现有有界重试，不增加无限认证重试；
- 对象摘要不一致或文件部分采集：任务失败并保留显式失败状态，不伪造成功产物。

TGC、应用 Cookie 和 storage state 不得进入 Git、任务载荷、Temporal metadata、对象存储、
PostgreSQL 或日志。当前门户服务依赖浏览器 SSO；不得增加 CAS REST、密码或 MFA 自动化来
绕过供应商约束。

## 相关文档

- `ingestion.md`
- `../data/internal-portal.md`
- `../contracts/file-release-export.md`
- `../contracts/ops-web.md`
