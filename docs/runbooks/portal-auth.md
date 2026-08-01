---
doc_type: runbook
owner_boundary: apps/ops-web
status: active
---

# 内部门户认证

## 运行模型

协作者先通过学校统一认证取得原始 `SSO_TGC`，再在 Ops Web 的“内部门户凭据”页面录入并验证。
Ops Web Node 后端使用该值建立一次真实 CAS 与门户会话；只有验证成功才把 CAS 返回的当前 TGC
写入 PostgreSQL `internal_portal.credentials`。系统允许同时保存多条具名凭据，不设置主凭据，也不
自动选择其中一条供采集运行时使用。

Ops Web 是已保存 TGC、检查结果和轮换操作的唯一所有者。`packages/internal-portal-client` 只实现
CAS 跳转、Cookie 会话和错误分类，不读取环境变量、文件、数据库或 Kubernetes。source-collector
只在一次本地命令或显式启动的进程中消费 `INTERNAL_PORTAL_SSO_TGC`，不持久化、不保活，也不从
Ops Web 自动读取凭据。

Service Ticket、`JSESSIONID` 和 `nginx` Cookie 只存在于当前 HTTP 会话内存。TGC 不进入 Git、
ConfigMap、Kubernetes Secret、URL、Temporal 载荷、对象存储、日志或浏览器存储。

## 录入与读取

1. 在 Ops Web 进入“内部门户凭据”，选择“新增凭据”。
2. 填写可辨认的名称和不带 `SSO_TGC=` 前缀的原始值。
3. 等待真实门户验证完成。CAS 拒绝或门户暂时不可用时，新增失败且不创建记录。
4. 需要开发时选择目标记录的“显示明文”并复制当前值。明文只保存在当前对话框的 React state，
   关闭后即从页面移除，不进入 TanStack Query cache 或 mutation 结果。

列表只返回标识、名称、版本、最近尝试、最近成功和结果分类，不返回 TGC。明文读取使用同源
`POST`；接口和页面响应均为 `Cache-Control: no-store`。

## 轮换与删除

轮换先使用候选 TGC 建立真实门户会话，成功后才按当前记录版本替换原值。CAS 拒绝、网络失败或
门户失败都不会覆盖原凭据。重命名、轮换和删除使用当前版本作为并发前置条件；页面版本过旧时操作
失败，刷新后由操作者重新决定，不自动重放。

CAS 可能在验证过程中刷新 `SSO_TGC`。Ops Web 保存刷新后的值并递增记录版本，后续明文读取和定时
检查都使用该值。

## 定时检查

`ops-web-internal-portal-check` CronJob 每分钟读取全部记录并顺序检查，每条门户调用最多等待 60 秒：

- `valid`：门户会话建立成功，更新最近成功时间并保存 CAS 返回的当前 TGC；
- `credential_rejected`：CAS 或门户明确拒绝该凭据；
- `check_failed`：网络、超时或其他依赖错误，不能据此判断凭据已失效。

单条认证失败不阻断后续记录。每次写回都使用检查开始时读取的 `credential_id + version`；检查期间
发生轮换或删除时，旧结果标记为 `stale`，不得覆盖新值。任一记录为 `credential_rejected` 或
`check_failed` 时本次 Job 以失败结束，使 Kubernetes 保留原生失败状态；详细结果同时保存在记录
元数据中。

CronJob 使用 Ops Web 同一镜像、ServiceAccount、数据库连接和 CA，只开放 DNS、PostgreSQL 5432
与外部 HTTPS 443 的 egress。它不访问 Kubernetes API，不触发通知或文件发布采集。

## 本地使用

从 Ops Web 取出目标值后，将其写入未跟踪的
`apps/source-collector/adapters/internal-portal/.env`：

```bash
INTERNAL_PORTAL_SSO_TGC=TGT-...
```

验证当前值：

```bash
pnpm --filter source-collector auth:check
```

该命令只执行一次并用退出码表示结果，不写状态文件。通知采集和显式启动的文件发布 worker 读取
同一直接变量。source-collector 不持久化该值，也不运行后台认证检查。

## 数据保留与环境重置

凭据保存在 Ops Web 所属 PostgreSQL schema，Pod 重启和普通滚动部署不会删除记录。删除或重建
包含该数据库的环境、清空 schema 或执行完整 staging namespace 重置后，记录不会自动恢复；环境
可用后必须由协作者重新录入并通过真实门户验证。GitOps 不保存或回填 TGC。

## 失败处理

- `OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED`：候选值已被拒绝，重新取得 TGC 后再新增或轮换；
- `OPS_INTERNAL_PORTAL_CHECK_FAILED`：候选验证暂时无法完成，保留原值并检查门户网络；
- `OPS_INTERNAL_PORTAL_CONFLICT`：记录在操作期间已变化，刷新页面后重新决定；
- `OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE`：检查 Ops Web 数据库 migration、授权、连接和 CA；
- `internal_portal_credential_unavailable`：本地直接变量缺失、为空或格式错误；
- `internal_portal_credential_expired`、`internal_portal_session_expired`：本地值已失效，从 Ops Web
  取得仍有效的记录或重新录入。

应用不会读取旧 Secret、恢复已删除的保活进程、自动选择其他凭据、重放采集或把认证失败伪装成
空结果。

## 相关文档

- `ingestion.md`
- `../data/internal-portal.md`
- `../contracts/ops-web/internal-portal.md`
- `../contracts/internal-portal-file-release.md`
