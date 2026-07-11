---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0055
status: accepted
created: 2026-06-15
updated: 2026-07-11
supersedes:
  - ADR-0049 separate campus-ops-web product surface owner
---
# ADR-0055 Unified Operator Console Surface

## 状态

Accepted on 2026-06-15.

ADR-0072 supersedes only the single implementation-surface assumption for privileged runtime
diagnosis. The unified business operations concept and all domain-operation boundaries in this ADR
remain accepted. `apps/ops-web` is a separate read-only diagnosis application, not a second business
operations backend.

## 背景

当前文档中存在一组互相冲突的 operator surface 口径：

- ADR-0011 已经把 `apps/operator-console-web` 冻结为受控 operator control plane 的
  Worker shell。
- ADR-0049 为 dining operations 新增了 `apps/campus-ops-web`，并把它写成 Campus
  Operations Control Plane 的长期 operator workspace。
- observability、official-web、authenticated notice processing 与 dining operations
  都通过 `apps/app-api` 的 operator-safe API / projection 消费 app-owned truth。

因此问题不是需要两个后台，而是需要把读诊断域与受控运营域统一到一个长期 operator 产品概念里。

## 决策

长期产品概念固定为一个受控 **Operator Console**。

Operator Console 承载：

- request / quality / safety / cost / audit observability domains
- official-web、authenticated notice processing 等 app-owned operator projection domains
- dining operations 等受控 operations domains
- 后续 provider / model / runtime settings 等运维配置 domain

`apps/app-api` 继续是 operator API、admission、projection 与 selected control-plane backend
owner。Operator Console 只能通过 app-api 暴露的 runtime-owned APIs 工作，不直连数据库、对象存储、
ingestion worker、execution-control、Temporal history、Qdrant 或 telemetry sink。

当前实现已收口到一个 Worker surface，但当前上线面是最小 Operator Console：

- `apps/operator-console-web` 当前只承载请求与运行值班台和 provider / model / API key
  配置。
- 请求与运行值班台只消费 `/api/overview`、`/api/operator/overview`、
  `/api/operator/runtime/health` 与 `/api/requests`。
- 模型服务配置只消费 `/api/operator/provider-config/*`。
- Official Web、authenticated notice processing、quality、safety、cost、standalone audit
  与 dining operations 都是长期 Operator Console domains，不是当前导航、路由或 Worker proxy
  暴露面。
- 当前 Worker 不 proxy `/api/ops/dining/*`、`/api/official-web/*`、standalone
  `/api/operator/audit*` 或 `/api/requests/*` 详情/observability prefix。

`apps/protected-panel-web` 与 `apps/campus-ops-web` 已从 active workspace 退役。包名和部署面不再定义两个长期产品后台。

## API Namespace

长期 operator API namespace 优先使用 `/api/operator/*`。

`/api/ops/dining/*` 是 app-api dining operations contract family，不是当前最小
`operator-console-web` Worker proxy surface。它只有在 dining workspace 重新进入 release scope、
具备明确 operator workflow、app-api contract 和验收测试后，才可以重新加入 Operator Console
导航与 Worker allowlist。文档不得把该 namespace 解释成第二套长期 ops product backend，也不得引入
隐式双写、fallback 或 silent route alias。

## Supersession

本 ADR 替代 ADR-0049 中“新增 `apps/campus-ops-web` 作为长期独立 Campus Operations
Control Plane surface owner”的判断。

ADR-0049 的以下内容继续生效：

- dining draft / release candidate / release / audit 分层
- candidate-first publish lifecycle
- student published projection 与 operator draft/candidate 分离
- source observation 只能作为 proposal / review boundary
- dining truth 与 navigation spatial truth 分离

ADR-0011 继续生效：

- protected operator surface 使用 Cloudflare Workers
- upstream Access 不能替代 origin admission
- Operator Console shell 只消费 runtime APIs
- UI shell 可以基于成熟 admin framework 承载 operator domains

ADR-0018 和 ADR-0023 继续生效，但其中的 `Operator Console` 表述应按 Operator Console 的
domain 口径理解：official-web 与 observability 是 Operator Console 的 operator domains，不能扩张成
generic infra console、sink explorer 或直接数据源浏览器。

## 非目标

- 不迁移 `/api/ops/dining/*` route。
- 不把 Operator Console 做成 generic internal-tools builder、SQL console、object-store
  browser 或 execution-control hidden admin mode。
- 不把 operator / ingestion / eval / release 工作包装成用户可调用 agent tools。

## 结果

- 文档中的长期产品概念统一为 Operator Console。
- 当前 active Operator Console implementation package 统一为 `apps/operator-console-web`。
- `protected-panel-web` 与 `campus-ops-web` 只在 historical ADR context 中作为被替代实现名出现。
- 新增 operator domain 时，应先说明它属于 Operator Console 的哪个 domain，再说明当前由哪个
  Worker package 承载。

## 相关文档

- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/operator-console.md`
- `docs/contracts/app-api/README.md`
- `docs/contracts/app-api/operator-ops.md`
- `docs/contracts/app-api/dining-ops.md`
- `docs/decisions/adr-0011-operator-console-worker-runtime.md`
- `docs/decisions/adr-0049-campus-ops-control-plane.md`
