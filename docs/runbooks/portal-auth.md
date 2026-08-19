---
doc_type: runbook
owner_boundary: ingestion-control
status: active
---

# 内部门户认证

## 运行模型

ingestion-control 是 TGC、检查结果和 CAS 刷新值的唯一运行所有者。Ops Web 提供人员页面和 automation
入口，但所有凭据操作都通过内部 HTTP 转发 ingestion-control。Source Collector 不读取数据库，也不按
名称选择记录。

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

`MUC-WIKI/sso-tgc-template` 是协作者自己的运行入口。协作者在自己的电脑或 GitHub Actions 中保存
学校账号、密码、目标凭据名称、endpoint 和 Bearer token，并自行决定 schedule；这些输入不会投递到集群。
模板的 Playwright 实现、依赖、测试和 workflow 由模板仓独立拥有；本仓只维护 Ops Web 自动化接口及
其服务端合同，不保留第二套提取器实现。
普通模式缺少任一轮换配置时在登录前失败，不会降级为 dry-run；目标名称必须恰好匹配一条具名凭据。
首次成功运行会按名称创建记录，后续每次成功运行都立即轮换同一条记录，不等待旧值过期，也不创建新记录。
多个协作者分别使用自己的账号和唯一具名凭据即可并行轮换，Ops Web 不新增主凭据或自动切换状态。

Service Ticket、`JSESSIONID` 和 `nginx` Cookie 只存在于当前 HTTP 会话内存。TGC 不进入 Git、
ConfigMap、Kubernetes Secret、URL、Temporal 载荷、对象存储、日志或浏览器存储；extractor 只在当前
进程内将它发送给 Ops Web 的一次创建或轮换请求。

## 定时检查

`ingestion-control-internal-portal-check` 每 30 分钟顺序检查未暂停记录：

- `valid`：更新最近成功时间，并保存 CAS 返回的当前 TGC；
- `credential_rejected`：记录明确拒绝并暂停后续定时检查；
- `check_failed`：记录依赖、网络或超时失败，下周期继续；
- `stale`：检查期间版本变化或记录删除，本次结果不落库。

单条业务结果不使 CronJob 失败；数据库或未处理异常使整轮返回非零。该检查不是可承诺续期的保活
协议，也不触发采集。

## 本地拉取

```bash
pnpm dev:init
pnpm --filter source-collector auth:pull
pnpm --filter source-collector auth:check
```

`auth:pull` 使用当前 kubectl context 和 namespace，从 `ops-web-internal-secrets` 读取既有
`OPS_WEB_INTERNAL_TOKEN`，只为本次命令建立 `service/ingestion-control:8000` 的临时 port-forward。
解析成功后原子更新
Source Collector 适配器本地托管环境中的 `INTERNAL_PORTAL_SSO_TGC`，权限为
`0600`；失败不改文件，命令不输出 token 或 TGC。

本机代理仅通过未跟踪环境显式配置：

```bash
INTERNAL_PORTAL_PROXY_SERVER=http://127.0.0.1:7897
```

## Job 入口

```bash
pnpm --filter source-collector notice:sync:job
pnpm --filter source-collector file:sync:job
```

两个入口读取 `INGESTION_CONTROL_INTERNAL_URL` 和 `OPS_WEB_INTERNAL_TOKEN`，解析 TGC 后以内存参数调用
现有采集实现。它们不读取本地 TGC 作为 fallback，不修改 `process.env`，没有可用凭据时明确失败。
当前 Kubernetes base 尚未部署这两个采集 Job 或 schedule。

## 数据升级与保留

Ops Web migration `0004_loud_loa.sql` 将旧 `internal_portal.credentials` 逐字段复制并双向比较到
`ingestion_control.internal_portal_credentials`，随后删除旧表。automation token 仍留在 Ops Web
schema。Pod 重启不会删除凭据；数据库或 schema 被重建后，GitOps 不会从 Secret 回填 TGC，必须重新
录入。

## 失败处理

- `INGESTION_INTERNAL_PORTAL_CREDENTIAL_REJECTED`：重新取得 TGC 后再录入或轮换；
- `INGESTION_INTERNAL_PORTAL_INPUT_INVALID`：检查 TGC/Cookie 格式；
- `INGESTION_INTERNAL_PORTAL_CHECK_FAILED`：检查门户网络和依赖；
- `INGESTION_INTERNAL_TOKEN_INVALID`：核对既有内部 token；
- `INGESTION_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE`：池中没有当前可用记录；
- `INGESTION_INTERNAL_PORTAL_CONFLICT`：刷新当前版本后重试；
- `INGESTION_INTERNAL_PORTAL_STORE_UNAVAILABLE`：检查 migration、授权、连接和 CA。

Ops Web 会把这些领域结果映射为对应的 `OPS_INTERNAL_PORTAL_*` 页面错误。

## 相关文档

- `ingestion.md`
- `../data/internal-portal.md`
- `../contracts/ops-web/internal-portal.md`
- `../decisions/adr-0089-internal-portal-credential-resolution.md`
