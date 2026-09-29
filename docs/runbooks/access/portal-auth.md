---
doc_type: runbook
owner_boundary: ops-web
status: active
---

# 内部门户认证

## 运行模型

Ops Web 是 TGC、检查结果和 CAS 刷新值的唯一运行所有者，直接提供人员页面、automation endpoint
和内部解析接口。internal-portal-collection 不读取数据库，也不按名称选择记录。

系统允许多条具名凭据，不维护主凭据。消费解析排除 `credential_rejected`，按 `valid`、未检查、
`check_failed` 逐条真实验证，返回第一条可用 TGC。采集会话随后得到的新 TGC 只在本次进程使用，不
回写。

## 录入、轮换与读取

1. 在 Ops Web 的“内部门户凭据”页面新增记录，填写唯一名称和裸 TGC 或包含唯一 `SSO_TGC` 的 Cookie。
2. 等待真实 CAS/门户验证；拒绝或依赖失败时不写候选值。
3. 重命名、轮换和删除都使用页面当前版本。版本冲突时刷新后重新决定。
4. “立即检查”更新最近检查 metadata；“显示明文”只把 TGC 放入当前对话框 state。

需要由外部程序维护凭据时，在同页生成 automation token，并使用页面显示的
`OPS_WEB_AUTOMATION_ORIGIN`。程序先读取 metadata，再以 ETag 作为 `If-Match` 创建、轮换或删除记录。
automation token 不用于采集消费。

外部凭据提取与轮换流程由
[MUC-WIKI/sso-tgc-template](https://github.com/MUC-WIKI/sso-tgc-template) 独立拥有；本仓只维护 Ops Web
自动化接口及其服务端合同。

Service Ticket、`JSESSIONID` 和 `nginx` Cookie 只存在于当前 HTTP 会话内存。TGC 不进入 Git、
ConfigMap、Kubernetes Secret、URL、Temporal 载荷、对象存储、日志或浏览器存储；extractor 只在当前
进程内将它发送给 Ops Web 的一次创建或轮换请求。

## 定时检查

`ops-web-internal-portal-check` 每 30 分钟顺序检查未暂停记录：

- `valid`：更新最近成功时间，并保存 CAS 返回的当前 TGC；
- `credential_rejected`：记录明确拒绝并暂停后续定时检查；
- `check_failed`：记录依赖、网络或超时失败，下周期继续；
- `stale`：检查期间版本变化或记录删除，本次结果不落库。

单条业务结果不使 CronJob 失败；数据库或未处理异常使整轮返回非零。该检查不是可承诺续期的保活
协议，也不触发采集。

## 本地拉取

```bash
pnpm dev:init -- --target internal-portal-collection
pnpm --dir jobs/internal-portal-collection auth:pull
pnpm --dir jobs/internal-portal-collection auth:check
```

`pnpm --dir jobs/internal-portal-collection auth:pull` 使用当前 kubectl context 和 namespace，从 `ops-web-internal-secrets` 读取既有
`OPS_WEB_INTERNAL_TOKEN`，只为本次命令建立 `service/ops-web:5178` 的临时 port-forward。
解析成功后原子更新 internal-portal-collection 本地托管环境中的 `INTERNAL_PORTAL_SSO_TGC`，权限为
`0600`；失败不改文件，命令不输出 token 或 TGC。

本机代理仅通过未跟踪环境显式配置：

```bash
INTERNAL_PORTAL_PROXY_SERVER=http://127.0.0.1:7897
```

## Job 认证边界

通知采集 Job 的创建命令和回填参数见[采集与发布](../ingestion/ingestion.md#kubernetes)。

这些模板读取 `OPS_WEB_INTERNAL_URL` 和 `OPS_WEB_INTERNAL_TOKEN`，解析 TGC 后以内存参数调用
与本地 CLI 相同的采集实现。Job 不读取本地 TGC 作为 fallback，没有可用凭据时明确失败。Kubernetes
base 为三种动作分别提供默认暂停的模板；它们没有 schedule，必须由维护者显式创建一次性 Job。

自动化 endpoint 与 Bearer token 不改变上述边界：endpoint 只是环境配置，token 只授权 Ops Web 机器
接口；internal-portal-collection 本地入口只读取拉取到托管环境的 TGC，Job 入口只调用 Ops Web 解析
接口。需要在没有真实门户凭据时验证 HTTP 链路，可运行
`pnpm --filter ops-web dev:fixture`；该 fixture 的 token 和 TGC 仅在本地进程生命周期内有效。

## 数据保留与恢复

Pod 重启不会删除凭据；数据库或 schema 被重建后，GitOps 不会从 Secret 回填 TGC，必须重新录入。

## 失败处理

- `OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED`：重新取得 TGC 后再录入或轮换；
- `OPS_INTERNAL_PORTAL_INPUT_INVALID`：检查 TGC/Cookie 格式；
- `OPS_INTERNAL_PORTAL_CHECK_FAILED`：检查门户网络和依赖；
- `OPS_INTERNAL_TOKEN_INVALID`：核对既有内部 token；
- `OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE`：池中没有当前可用记录；
- `OPS_INTERNAL_PORTAL_CONFLICT`：刷新当前版本后重试；
- `OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE`：检查 migration、授权、连接和 CA。

Ops Web 会把这些领域结果映射为对应的 `OPS_INTERNAL_PORTAL_*` 页面错误。

## 相关文档

- [采集运行](../ingestion/ingestion.md)
- [内部门户数据](../../data/internal-portal.md)
- [内部门户凭据接口](../../contracts/ops-web/internal-portal.md)
- [简化采集控制面与内部门户凭据所有权](../../../.agents/notes/implemented/simplification/2026-08-19-internal-portal-credential-resolution.md)
