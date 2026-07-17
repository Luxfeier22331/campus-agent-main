---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0080
status: accepted
supersedes:
  - ADR-0011
  - ADR-0055
partially_supersedes:
  - ADR-0064
  - ADR-0072
---

# ADR-0080：统一 Ops Web 运维产品

## 背景

仓库曾同时维护 Cloudflare Worker `operator-console-web` 和自托管 `ops-web`。前者只代理
app-api 的模型服务配置接口，后者已经承担运行排查、食堂管理和固定内部门户认证。两个运维
产品造成域名、权限、导航、部署和数据所有权重复，app-api 也因此持有与学生产品无关的模型
密钥和配置写接口。

## 决策

`apps/ops-web` 是唯一运维产品，统一使用环境仓配置的 `ops-staging.mucwiki-edge.link` 等
`ops-*` 域名。`operator-console-web`、`panel-*` 域名和对应 Worker 全部退役，不提供重定向、
代理或兼容路由。

模型服务配置遵循以下边界：

- Ops Web 通过 Cloudflare Access 和自身 allowlist 识别人类与服务身份；服务身份只读，写操作
  只接受同源的人类请求；
- `provider_config.*` 保存连接候选、加密 API key、profile revision 和验证结果，由
  `ops_web_provider_config` 角色读写；app-api 无权限且不暴露相关接口；
- prompt、embedding 和 rerank profile 必须先验证，再按 role 激活；生效 profile 和连接不可
  原地修改；
- 激活产生 `provider_config_projection.v2`，包含 publication、操作者和所有生效 role；
- Ops Web 以 Kubernetes `resourceVersion` CAS 更新固定 Secret
  `execution-runtime-provider-config`，写后重新读取并校验摘要；
- Kubernetes Secret projection 是 active runtime truth。PostgreSQL 不保存 `active` 标记，
  GitOps 只声明固定 Secret 元数据并忽略 Ops Web 管理的 `data` 与发布注解；
- 本地开发使用同一 v2 合同和原子文件 publisher，不维护 seed、手工 sync 或 v1 fallback。

Ops Web 仍不是通用数据库浏览器、Secret 管理器、Kubernetes 控制台或任意请求代理。每个写
能力必须绑定固定资源、专用数据库角色或窄服务接口。

## 后果

- 运维人员只有一个站点、一个导航和一套 Access 策略；
- app-api 回到学生产品、身份、会话和请求生命周期边界；
- runtime 不在热路径调用控制面，Secret volume 更新后读取同一受版本化 projection；
- 配置发布并发冲突明确失败，不静默覆盖其他操作者发布；
- 首次部署可以没有 active profile，Ops Web 仍需就绪并允许进入修复页面；依赖该 role 的
  runtime 则保持失败关闭。

## 否决方案

- **保留两个运维产品**：继续复制域名、认证、UI 和发布流程；
- **把 Provider Config 留在 app-api**：让学生产品后端持有内部模型密钥和运维写接口；
- **由 GitOps 保存 active profile**：部署仓不具备 provider 验证、revision 和操作者语义；
- **Ops Web 在热路径代理 provider**：增加单点和延迟，并扩大密钥暴露面；
- **保留 v1 或手工 sync**：形成双真相并让错误配置静默存活。

## 相关文档

- `docs/architecture/system/product-runtime.md`
- `docs/environment/providers.md`
- `docs/runbooks/provider-secrets.md`
- `docs/data/postgres-ownership.md`
