---
doc_type: product_requirement
owner_boundary: docs/product
status: active
---

# Ops Web 产品需求

## 文档范围

本文定义 `ops-web` 的用户问题、功能范围、页面要求和验收标准。接口字段由
`../contracts/ops-web.md` 定义，数据来源和组件职责由
`../architecture/system/ops-observability.md` 定义，部署环境由独立 GitOps 仓库管理。

## 项目概况

| 项目 | 内容 |
| --- | --- |
| 产品名称 | Ops Web |
| 产品形态 | 自托管、受访问保护、默认只读的运维网站 |
| 主要用户 | 值班人员、运行服务负责人、排查问答链路的工程师 |
| 主要任务 | 判断系统是否正常、查找请求、定位执行问题、维护在线 Provider Config 与固定门户认证 |
| 应用结构 | 一个 Node/Hono 进程同时提供 React 页面和 `/api/ops/*` |
| 访问保护 | Cloudflare Access 加应用内操作者白名单 |
| 相关产品 | Operator Console 已退役；Ops Web 是唯一运维浏览器面 |

## 背景

Operator Console 与 app-api operator/provider 路径已经退役。运行排查和在线 Provider Config
统一从自托管 Ops Web 进入：排查读取受限 PostgreSQL 与 Axiom，配置通过同源 BFF 调用
execution-control admin。浏览器不获得数据库、Axiom、keyring 或 admin credential。

Temporal UI、Langfuse UI、Sentry 和 Axiom 已分别提供完整工作流、模型观测、错误与通用运行
信号能力。Ops Web 不复制这些产品，而是从一次请求出发展示必要摘要、固定 Axiom 记录、关联
标识和跳转入口。OpenObserve 不属于当前产品或回滚路径。

## 目标

Ops Web 必须让值班人员直接回答五个问题：

1. 当前请求处理、关键服务、Temporal 队列和三类 Axiom 数据是否正常。
2. 某次请求最终处于什么状态，经过了哪些执行步骤，使用了哪些模型、工具和来源。
3. 该请求的日志、调用链和外部系统入口在哪里，哪些数据当前不可用。
4. 在线 Provider Config 当前激活哪个 revision，required role 是否完整，如何安全创建、验证和
   原子激活配置。
5. 内部门户凭据是否已配置，固定维护 Schedule 是否正常，失效后如何安全替换凭据。

同时满足以下边界：

- 请求状态只由运行链路写入的 PostgreSQL 摘要决定。
- 观测平台、健康检查和外部链接不能改写请求状态。
- 数据缺失、查询成功但没有记录、旧缓存和查询失败必须有不同显示。
- 浏览器不能获得数据库或观测平台凭据，也不能提交任意 APL、dataset 或时间窗口。

## 用户故事

### 查看运行概况

值班人员打开首页后，可以选择 15 分钟、1 小时、6 小时或 24 小时窗口，并看到：

- 整体状态和当前问题；
- 请求总量、成功率、95% 请求耗时和趋势；
- `campus-web`、`app-api`、`execution-control`、`agent-runtime`、`ops-web` 的状态；
- Temporal task queue 的积压、最久等待和 worker 数量；
- Axiom log、metric 和 trace dataset 是否持续写入；
- 已配置的 Temporal、Langfuse、Sentry 和 Axiom 入口。

Axiom 三类信号独立查询；一个 dataset 失败时，其他成功结果仍可查看。低流量窗口没有日志或
调用链不自动判为故障，持续指标没有数据必须显示为降级。页面使用最近一次成功概况时，必须
显示生成时间和旧数据状态。

### 查找请求

值班人员可以按时间、状态、关键词、`requestId`、`conversationId` 或 `traceId` 查找请求。
列表展示请求状态、问题摘要、工具、错误、耗时和更新时间，并支持服务端游标翻页。

筛选条件保存在 URL 中。刷新或修改筛选时保留上一组数据，直到新结果返回；无效 URL 参数会
被移除并提示，不导致页面崩溃。

### 排查请求

请求详情分为三个区域：

1. **概览**：状态、关联标识、模型和提示词版本、工具、结果分类、访问控制结果、来源、
   分段耗时和观测数据更新时间。
2. **执行**：工作流模式、选择结果、运行版本和步骤记录；步骤只展示已保存的步骤标识、类型、
   工具、重试次数、状态和结果摘要。
3. **日志与调用链**：按当前请求读取 Axiom 固定字段记录，并展示实际查询时间范围、数量、耗时
   和是否截断。

详情页提供关联标识复制和已配置系统的跳转入口。Axiom 查询失败、无记录或 partial response
都不能改变请求状态；partial response 必须按不可用处理，不能展示为完整结果。

### 替换门户认证

人员操作者可以查看固定内部门户凭据是否已配置、最近更新时间和更新人，以及固定 Schedule
的状态、最近维护结果和已观测有效区间。操作者可以粘贴原始 `SSO_TGC` 或包含唯一
`SSO_TGC` 的 Cookie 字符串完成替换；页面不读取或显示当前值，提交成功后立即清空输入。

凭据替换后页面显示 Schedule 恢复结果，但不声称已经立即验证门户。恢复失败时可以显式重试
固定 Schedule。服务令牌不能读取该页面或执行操作。

### 维护在线 Provider Config

所有获准操作者可以查看 connection revision、profile validation、active revision 和 required
role 完整性。只有进入独立人员写白名单的操作者可以创建不可变 connection/profile、触发验证，
并以 `expectedRevision` 原子激活完整 bundle；服务令牌始终只读。

API key 输入提交后立即清空，页面只显示末四位和不可逆 fingerprint。写请求必须同源、使用
JSON 和幂等键。Provider Config admin 不可用只影响该页面，不影响请求排查和 readiness。

## 页面和交互

- `/` 重定向到 `/overview`。
- 一级导航为“运行概况”、“请求排查”、“Provider Config”和“门户认证”。
- `/providers` 展示在线 connection/profile revision、验证和完整 bundle 激活。
- `/internal-portal-auth` 展示固定凭据和维护状态，并提供替换与恢复操作。
- `/requests/:requestId` 通过“概览 / 执行 / 日志与调用链”标签切换内容。
- 不提供 `/runtime`、通用日志搜索、Axiom 控制台、数据库浏览或隐藏兼容路由。

数据表使用 `@tanstack/react-table`，长记录列表使用 `@tanstack/react-virtual`，趋势使用
Recharts，图标使用 Lucide。状态必须同时使用文字，不能只依赖颜色。

桌面端使用侧栏和数据表；移动端使用可关闭侧栏、纵向请求列表和纵向状态列表。320、390 和
1440 像素宽度下不得出现页面级横向溢出、文本重叠或不可达控件。所有按钮、筛选和标签必须
支持键盘操作、可见焦点、加载状态和禁用状态。

## 数据和权限

Ops Web 只读取以下 PostgreSQL 来源中明确授权的列：

- `chat.turn_dispatches`
- `chat.messages`
- `runtime.agent_runs`
- `runtime.request_observability_fact`

页面可展示问题摘要和不可逆用户标识摘要，不展示完整用户身份、原始对话、原始提示词、原始
回答、记忆正文或检索片段正文。Temporal 队列状态由 Ops Web 服务端调用 execution-control 的
内部只读接口获得，进程内缓存 15 秒，不写入 PostgreSQL。

### 日志和调用链

- 浏览器只能选择 `logs` 或 `trace`。
- 服务端从已保存请求取得 `requestId` 与时间，再生成固定 Axiom Edge APL。
- 窗口为请求开始前五分钟到完成后五分钟，未完成请求以当前时间为上限，最大 30 分钟。
- 日志最多返回 200 条，调用链最多返回 500 条；字段投影、升序排序和上限均由服务端固定。
- Axiom partial response、超时、无效 JSON/表格或 HTTP 错误都失败关闭。
- 查看原始记录需要比普通 Ops Web 访问更窄的权限。
- 每次成功返回原始记录前必须写读取审计；审计写入失败时拒绝返回记录。
- 读取审计保留 180 天，固定清理函数由独立维护账号执行。

Ops Web 使用限定三个 dataset 的 query-only token，不得使用 personal token、ingest token、
Terraform token 或浏览器内 credential。

### 访问控制

- 所有 `/api/ops/*` 请求验证 Cloudflare Access JWT 的签发方、受众和签名。
- 人员邮箱或服务令牌 ID 必须进入基础操作者白名单。
- 原始日志和调用链使用独立白名单，基础权限不能自动获得原始记录权限。
- 门户认证只允许基础白名单中的人员身份，服务令牌不能读取状态或替换凭据。
- Provider Config 服务令牌只读；写操作要求独立人员白名单、同源、JSON 和幂等键。
- `/readyz` 无需操作者登录，但必须验证 Access 配置、数据库读取权限和审计写权限。

## 缓存和故障处理

- 运行概况在每个服务进程内缓存 15 秒。
- PostgreSQL 和运行信号都失败时，只能使用五分钟内的最近完整概况，并标为 `STALE`。
- 请求列表、详情、日志和调用链不使用共享缓存。
- PostgreSQL 失败时不能返回空请求列表来伪装成功。
- Axiom 全部或部分失败时，对应观测区域显示不可用；请求列表和详情仍可使用。
- Provider Config admin、Kubernetes API 或认证维护接口失败只影响对应页面。
- `/healthz` 只证明进程响应；`/readyz` 不因 Axiom 或被观测服务故障而失败。

## 非工作范围

- 修改请求状态、重跑请求、取消工作流或发送任意 Temporal 命令。
- 复制 Temporal UI、Langfuse UI、Sentry 或 Axiom 的通用界面。
- 直接查询 Hindsight、Temporal persistence 或 Langfuse 数据库。
- 提供任意 SQL、APL、dataset、时间范围或任意外部 API 代理。
- 同步、缓存或镜像外部平台正文。
- 质量评测、数据集管理、人工标注和学习闭环工作台。
- 创建、列举、删除通用 Secret，在线登录学校门户或编辑任意 Temporal Schedule。
- 恢复 OpenObserve 或为只有一个页面消费方的接口拆出独立 `ops-api`。

## 验收标准

- 根路径、四个一级页面和三个详情标签按本文信息结构工作。
- 运行概况分别显示请求、五个服务、Temporal 队列和三类 Axiom 信号状态。
- 部分来源失败、无数据、partial response 和旧缓存有不同且可见的状态。
- 请求筛选、游标翻页、可分享 URL、空状态和刷新失败状态均可使用。
- 浏览器不能控制 APL、dataset、`traceId`、时间范围、字段投影或返回上限。
- query token 不是 personal/ingest/管理 token，原始记录权限和读取审计均为拒绝优先。
- 人员可以替换固定门户 Secret；服务令牌、跨站请求和凭据回显被拒绝。
- 获准人员可以创建、验证并按预期 revision 激活完整在线 bundle；服务令牌不能写。
- 非本地 PostgreSQL 连接验证 CA 和主机名，不能降级为不验证证书。
- 所有 API 错误都以错误状态返回，不能改写为成功空数据或部分成功。
- 320、390 和 1440 像素浏览器测试通过；类型检查、单元测试、构建、镜像和 Kustomize 渲染通过。

## 发布边界

应用源码、镜像发布、namespace-neutral K8s base 和集群内依赖 NetworkPolicy 位于本仓库。
环境的 ConfigMap、Secret、Ingress、API Service IP 与外部 HTTPS 网络补丁、数据库角色、Axiom
dataset/retention 和 Collector 配置位于私有 GitOps 仓库。清单渲染、Terraform plan 或镜像发布
不代表应用上线；只有环境变更合并并完成真实访问、权限拒绝与 Axiom 查询验证后，才能记录部署
完成。

Cloudflare application-log destination 绕过 Collector 白名单。staging 必须验证 producer 清理
后的允许日志可查询，且 query、header、正文、用户标识和 credential 哨兵在 Axiom 中均为零
匹配；`invocation_logs=false` 且 native traces 关闭。请求调用链证据来自 W3C context 进入
execution-control 后由 Collector 写入 Axiom 的 runtime trace。失败时先关闭 log destination 或
对应 producer 输出；OpenObserve 的破坏性删除必须在该门禁通过后另行执行。

## 参考资料

- Temporal Web UI：<https://docs.temporal.io/web-ui>
- Langfuse 可观测性：<https://langfuse.com/docs/observability/overview>
- Axiom APL：<https://axiom.co/docs/apl/introduction>
- Cloudflare Workers OpenTelemetry：
  <https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/>
