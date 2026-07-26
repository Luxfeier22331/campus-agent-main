---
doc_type: runbook
owner_boundary: source-collector
status: active
---

# 内部门户认证

## 当前边界

source-collector 通过 `INTERNAL_PORTAL_SSO_TGC_FILE` 读取只包含原始 `SSO_TGC` 的凭据文件。
Playwright 使用该 TGC 取得 Service Ticket，并在单次 worker 本地目录中派生 `JSESSIONID`、`nginx`
和 storage state。派生状态不是共享状态或下游合同。

内部门户 ingestion runtime 当前未部署，Ops Web 也不提供凭据写入、验证或维护页面。仓库中的认证
命令用于本地开发和来源验证；环境重新启用该来源前，必须由环境仓明确交付凭据文件和工作负载。

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

`auth:save` 打开可见浏览器，等待人员完成学校 SSO，只把原始 TGC 以 `0600` 权限写入指定文件。
两个检查命令分别验证通知和文件发布入口；`auth:refresh` 强制取得新的 Service Ticket、建立门户
会话并探测通知接口。命令不得在终端输出凭据。

## 失败处理

- `internal_portal_credential_unavailable`：文件缺失、为空或格式错误，重新准备凭据文件；
- `internal_portal_credential_expired`：门户未签发 Service Ticket，重新取得 TGC；
- 短暂网络错误：保留活动已有的有界重试，不增加无限认证重试；
- 对象摘要不一致或文件部分采集：任务失败并保留显式状态，不伪造成功产物。

TGC、应用 Cookie 和 storage state 不得进入 Git、任务载荷、Temporal metadata、对象存储、
PostgreSQL 或日志。当前门户服务依赖浏览器 SSO；不增加 CAS REST、密码或 MFA 自动化路径。

## 相关文档

- `ingestion.md`
- `../data/internal-portal.md`
- `../contracts/file-release-export.md`
