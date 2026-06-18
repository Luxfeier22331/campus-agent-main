---
doc_type: architecture
truth_scope: product
owner_boundary: apps/operator-console-web
status: active
created: 2026-06-08
updated: 2026-06-18
---
# Operator Console Operations Architecture

## 文档边界

本文冻结当前 `apps/operator-console-web` 最小 operations implementation surface，以及后续
operations domain 重新进入 Operator Console 的准入条件。

它回答：

- 当前 Operator Console 真实上线面承载哪些运维能力
- Worker shell 与 `app-api` 受控转发路由清单如何分层
- provider/model/API key 在线配置如何进入同一个 operator data surface
- dining operations 这类长期 domain 如何在未来重新开放
- 为什么未实现 operations domains 不能以占位路由、隐藏 proxy 或假就绪指标进入当前产品面

它不负责：

- dining object schema，见 `docs/data/dining-operations-schema.md`
- dining HTTP contract，见 `docs/contracts/app-api-dining-ops-http.md`
- Operator Console observability query，见
  `operator-observability-architecture.md`
- account / OAuth browser experience，见 identity browser architecture 文档

## Core Conclusion

Operator Console 是唯一长期受控 operator product concept。当前最小实现只承载两个上线面：

- 请求与运行值班台
- 模型服务配置

Dining、Official Web、Authenticated Notice、Quality、Safety、Cost、standalone
Audit 与离线 Eval 都不是当前 `operator-console-web` 导航、路由或
Worker proxy 暴露面。它们可以作为长期 Operator Console domains
保留在架构文档中，但不能被当前实现伪装成已就绪。

当前 topology：

```text
operator browser
-> operator-console-web Worker shell
-> explicit minimal Worker route allowlist
-> app-api operator APIs
-> app-owned sanitized projections / provider config store
```

它不是：

- account browser shell 的隐藏扩展
- `operator-console-web` 之外的第二个长期后台产品
- `campus-web` 的隐藏编辑模式
- generic internal-tools builder
- dining / official-web / eval 的占位入口集合

## Runtime Boundary

当前 `operator-console-web` implementation surface 使用 Worker shell：

- serve static assets
- expose `GET /healthz` and `GET /readyz`
- proxy explicit request / runtime routes:
  - `GET /api/overview`
  - `GET /api/operator/overview`
  - `GET /api/operator/runtime/health`
  - `GET /api/requests`
- proxy explicit provider configuration routes:
  - `GET /api/operator/provider-config/profiles`
  - `POST /api/operator/provider-config/profiles`
  - `PATCH /api/operator/provider-config/profiles/:profileId`
  - `POST /api/operator/provider-config/profiles/:profileId/validate`
  - `POST /api/operator/provider-config/profiles/:profileId/activate`
- reject unknown `/api/*`
- reject `/api/federation/*`
- reject `/api/auth/*`
- reject `/api/ops/dining/*`
- reject `/api/official-web/*`
- reject standalone `/api/operator/audit*`
- reject `/api/requests/*` request detail / observability prefix until a visible
  request detail workflow returns

Auth/session truth stays in `app-api` / identity platform. The operations
surface only consumes operator admission results through proxied operator
routes. It does not own a second operator backend.

## Information Architecture

Current implemented routes:

- `/` redirects to `/requests`
- `/requests`
- `/operations/provider-config`

Current navigation labels:

- `请求与运行`
- `模型服务配置`

No other page may appear in the navigation, route table, fake status matrix or
Worker allowlist until the domain has a concrete workflow, current app-api
contract, UI implementation and acceptance tests.

## Request And Runtime Workspace

The current request/runtime workspace is a first-line operator view. It shows
only minimum online answer path data needed for launch triage:

- recent request list from `app-api` request projection
- accepted / completed / errored request counts
- execution runtime health projection
- explicit runtime blockers when app-api reports them
- current operator identity summary from the protected shell envelope

Rules:

- The page must show backend query errors as errors; it must not disguise
  failed reads as an empty list.
- The page must not expose raw telemetry, Temporal history, raw traces, raw
  prompts, raw answers, release evidence or offline eval results.
- Request detail, step trajectory and observability drilldown are not current
  UI workflows. Their proxy routes must remain absent until a visible request
  detail workflow is deliberately restored.

## Provider Configuration Workspace

Provider configuration manages OpenAI-compatible prompt and embedding runtime
profiles for the online answer path. It is not a generic secrets vault,
multi-provider registry or provider marketplace.

The browser UI must describe profile `role` as operator-facing `使用位置`.
Internal role identifiers remain API/profile fields, but they must not become
the primary user-facing copy.

Accepted profile roles:

- prompt: `primary_agent`, `rag_synthesis`
- embedding: `rag_query_embedding`, `index_embedding`

Accepted commands:

- create draft profile with service endpoint, model name, timeout, usage,
  transport and API key
- update inactive profile
- validate profile against provider endpoint
- activate validated profile

Embedding activation must fail closed when the configured model/dimensions are
not compatible with active retrieval vector dimensions. App-api performs that
check by calling execution-control internal
`/internal/provider-config/embedding:check-compatibility` with candidate
metadata only; raw API keys stay in app-api encrypted persistence and are not
sent to the compatibility endpoint. The UI may show validation and activation
errors, but it must not invent fallback provider values or expose raw API keys.

## Dining Workspace Reopening Contract

Dining operations remains a possible long-term Operator Console domain, but it
is not part of the current minimal implementation. The current Worker does not
ship dining UI and does not proxy `/api/ops/dining/*`.

If dining workspace is reopened, it must re-enter through a deliberate release
scope with:

- concrete operator workflow and route map
- current `app-api` dining operations contract
- explicit Worker allowlist entries
- UI implementation and browser smoke path
- unit / worker tests proving only accepted dining routes are proxied
- copy that describes operator work, not internal architecture

The accepted dining product shape, when reopened, remains candidate-first:

```text
edit draft -> create candidate -> validate -> approve -> publish now / schedule
```

The workspace must not expose a control that publishes the mutable current draft
without a candidate. It must not auto-seed dining data, synthesize a draft
version, or fall back to static floorplan data as editable truth. Initial dining
state is created by the app-api seed/release path and then consumed through
accepted operator APIs.

Dining floorplans are repo-owned versioned static SVG assets. If dining returns,
the workspace does not upload/replace SVG, does not use Konva/react-konva as the
primary floorplan technology and does not include freeform floorplan shape
editing. If a floor SVG changes, the change ships through an application release
and the generated floorplan manifest, not through an operator upload control.

## Forbidden Shapes

- Do not embed operations workspace inside the account browser shell.
- Do not let `campus-web` call `/api/ops/*`.
- Do not expose generic `/api/*` proxy.
- Do not surface federation or auth management inside Operator Console
  operations.
- Do not treat `operator-console-web` as a second long-term operator product
  backend.
- Do not return raw provider API keys to Operator Console browser code.
- Do not let execution-control or agent-runtime bypass app-api active provider
  profiles for online serving provider/model/API key truth.
- Do not let source observations mutate published projections without explicit
  review and release.
- Do not expose fake readiness for domains that are not in the current
  navigation and route table.
- Do not keep hidden proxy routes for pages removed from the current UI.
- Do not put offline eval, release evidence, raw trace or sink explorer
  workflows in the online Ops Panel.

## Staging Surface

Staging route target is `https://operator-console-staging.mucwiki-edge.link`.

Current minimal staging acceptance requires:

- unauthorized user cannot access the Operator Console shell or minimal ops APIs
- operator can open `/requests`
- operator can see request/runtime data or an explicit backend error
- operator can open `/operations/provider-config`
- operator can list provider profiles without seeing raw provider API keys
- operator can create/update/validate/activate provider profiles through app-api
  routes
- removed domains return 404 through the Worker rather than proxying upstream

Dining staging acceptance only applies when dining is explicitly returned to
release scope.
