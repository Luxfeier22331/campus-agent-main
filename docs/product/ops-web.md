---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-07-07
updated: 2026-07-16
---

# Ops Web 产品需求

## 文档范围

本文按照 Atlassian 的产品需求文档结构，定义 `ops-web` 的用户问题、功能范围、
页面要求和验收标准。接口字段由 `../contracts/ops-web.md` 定义，数据来源和组件职责由
`../architecture/system/ops-observability.md` 定义，部署环境由独立 GitOps 仓库管理。

## 项目概况

| 项目 | 内容 |
| --- | --- |
| 产品名称 | Ops Web |
| 产品形态 | 自托管、受访问保护、默认只读的运维网站 |
| 主要用户 | 值班人员、运行服务负责人、排查问答链路的工程师 |
| 主要任务 | 判断系统是否正常、查找请求、定位执行或观测数据问题 |
| 应用结构 | 一个 Node/Hono 进程同时提供 React 页面和 `/api/ops/*` |
| 访问保护 | Cloudflare Access 加应用内操作者白名单 |
| 相关产品 | `operator-console-web` 继续承担现有配置和业务操作，不由本项目替换 |

## 背景

现有 `operator-console-web` 是 Cloudflare Worker 上的受控操作入口，适合调用
`app-api` 提供的配置和业务操作接口。运行排查还需要读取自托管 PostgreSQL 中的请求摘要、
集群服务健康状态和集群内观测数据。让 Worker 代为读取这些数据会扩大公开 API 和 Worker
凭据范围，因此新增独立的自托管 Ops Web。

Temporal UI 和 Langfuse UI 已分别提供完整工作流历史、模型调用和评测能力。Ops Web 不复制
这些产品，而是从一次请求出发展示必要摘要、关联标识和跳转入口。Sentry、Axiom 继续保留
现有外部观测用途；内网排查所需的日志和调用链从自托管 OpenObserve 读取。

## 目标

Ops Web 必须让值班人员直接回答三个问题：

1. 当前请求处理、关键服务、Temporal 队列和观测数据是否正常。
2. 某次请求最终处于什么状态，经过了哪些执行步骤，使用了哪些模型、工具和来源。
3. 该请求的日志、调用链和外部系统入口在哪里，哪些数据当前不可用。
4. 内部门户短期认证是否已配置，并能在失效后直接替换。

同时满足以下边界：

- 请求状态只由运行链路写入的 PostgreSQL 摘要决定。
- 观测平台、健康检查和外部链接不能改写请求状态。
- 数据缺失、查询成功但没有记录、缓存结果和查询失败必须有不同显示。
- 浏览器不能获得数据库或观测平台凭据，也不能提交任意查询。

## 用户故事

### 查看运行概况

值班人员打开首页后，可以选择 15 分钟、1 小时、6 小时或 24 小时窗口，并看到：

- 整体状态和当前问题；
- 请求总量、成功率、95% 请求耗时和趋势；
- `campus-web`、`app-api`、`execution-control`、`agent-runtime`、`ops-web` 的状态；
- Temporal 任务队列的积压、最久等待和工作进程数量；
- 日志、指标和调用链是否持续写入；
- 已配置的 Temporal、Langfuse、Sentry、Axiom 和 OpenObserve 入口。

单个来源失败时，其他区域仍可查看。页面使用最近一次成功结果时，必须明确显示数据生成时间。

### 查找请求

值班人员可以按时间、状态、关键词、`requestId`、`conversationId` 或 `traceId` 查找请求。
列表展示请求状态、问题摘要、工具、错误、耗时和更新时间，并支持服务端游标翻页。

筛选条件保存在 URL 中。刷新或修改筛选时保留上一组数据，直到新结果返回；无效 URL 参数
会被移除并提示，不导致页面崩溃。

### 排查请求

请求详情分为三个区域：

1. **概览**：状态、关联标识、模型和提示词版本、工具、结果分类、访问控制结果、来源、
   分段耗时和观测数据更新时间。
2. **执行**：工作流模式、选择结果、运行版本和步骤记录；步骤只展示已保存的步骤标识、
   类型、工具、重试次数、状态和结果摘要。
3. **日志与调用链**：按当前请求读取 OpenObserve 记录，并展示查询时间范围、数量、耗时和
   是否截断。

详情页提供关联标识复制和已配置系统的跳转入口。日志或调用链读取失败不能改变请求状态。

### 替换门户认证

人员操作者可以查看内部门户认证是否已配置、最近更新时间和更新人，并粘贴原始
`SSO_TGC` 或包含该值的 Cookie 字符串。页面不读取或展示当前值，替换成功后立即清空输入。
页面同时展示半小时维护 Schedule、最近 Service Ticket 签发、下次验证和当前凭据的已观测
有效时长。服务令牌不能执行该操作。凭据过期时 Schedule 暂停；替换成功后自动恢复并等待
下一个周期，恢复失败时人员操作者可以重试。

## 页面和交互

### 信息结构

- `/` 重定向到 `/overview`。
- 一级导航为“运行概览”、“请求排查”和“门户认证”。
- `/internal-portal-auth` 展示状态并提供单一替换操作。
- `/requests/:requestId` 通过“概览 / 执行 / 日志与调用链”标签切换内容。
- 不提供 `/runtime`、通用日志搜索、数据库浏览或隐藏的兼容路由。

### 组件

- 页面骨架使用仓库内 shadcn/Radix 风格组件。
- 数据表使用 `@tanstack/react-table`。
- 长日志和调用链列表使用 `@tanstack/react-virtual`。
- 请求趋势使用 Recharts。
- 图标使用 Lucide；状态必须同时使用文字，不能只依赖颜色。

### 响应式要求

- 桌面端使用侧栏和数据表。
- 移动端使用可关闭侧栏、纵向请求列表和纵向状态列表。
- 320、390 和 1440 像素宽度下不得出现页面级横向溢出、文本重叠或不可达控件。
- 所有按钮、筛选和标签必须支持键盘操作、可见焦点、加载状态和禁用状态。

## 数据和权限

### 请求摘要

Ops Web 只读取以下 PostgreSQL 来源中明确授权的列：

- `chat.turn_dispatches`
- `chat.messages`
- `runtime.agent_runs`
- `runtime.request_observability_fact`

Temporal 队列状态由 Ops Web 服务端调用 execution-control 的内部只读接口获得，进程内缓存
15 秒，不写入 PostgreSQL。

页面可展示问题摘要和不可逆用户标识摘要，不展示完整用户身份、原始对话、原始提示词、
原始回答、记忆正文或检索片段正文。

### 日志和调用链

- 浏览器只能选择“日志”或“调用链”。
- 服务端从已保存请求中取得关联标识和时间范围，再生成固定 OpenObserve 查询。
- 日志最多返回 200 条，调用链最多返回 500 条。
- 查看原始记录需要比普通 Ops Web 访问更窄的权限。
- 每次成功返回原始记录前必须写读取审计；审计写入失败时拒绝返回记录。
- 读取审计保留 180 天，固定清理函数由独立维护账号执行。

### 访问控制

- 所有 `/api/ops/*` 请求验证 Cloudflare Access JWT 的签发方、受众和签名。
- 人员邮箱或服务令牌 ID 必须进入基础操作者白名单。
- 原始日志和调用链使用独立白名单，基础权限不能自动获得原始记录权限。
- 门户认证只允许基础白名单中的人员身份；服务令牌不能读取状态或替换凭据。
- Ops Web 的 Kubernetes RBAC 只允许 `get`、`patch` 固定的内部门户 Secret。
- `/readyz` 无需操作者登录，但必须验证 Access 配置、数据库读取权限和审计写权限。

## 缓存和故障处理

- 运行概况在每个服务进程内缓存 15 秒。
- PostgreSQL 和运行信号都失败时，只能使用五分钟内的最近成功概况，并标为旧数据。
- 请求列表、详情、日志和调用链不使用共享缓存。
- PostgreSQL 失败时不能返回空请求列表来伪装成功。
- OpenObserve 失败时，请求列表和详情仍可使用；观测区域显示不可用。
- 单个健康检查超时不能阻塞其他健康检查。
- `/healthz` 只证明进程响应；`/readyz` 不因 OpenObserve 或被观测服务故障而失败。

## 非工作范围

- 修改请求状态、重跑请求、取消工作流或发送 Temporal 命令。
- 复制 Temporal UI、Langfuse UI、Sentry、Axiom 或 OpenObserve 的通用查询界面。
- 直接查询 Hindsight、Temporal persistence 或 Langfuse 数据库。
- 提供任意 SQL、任意数据流、任意时间范围或任意外部 API 代理。
- 同步或缓存 Sentry、Axiom 的接口响应。
- 质量评测、数据集管理、人工标注和学习闭环工作台。
- 配置供应商、发布校园内容或承接现有 `operator-console-web` 的业务操作。
- 创建、列举、删除通用 Secret，在线登录学校门户或编辑任意 Temporal Schedule。
- 为只有一个页面消费方的接口拆出独立 `ops-api` 服务。

## 验收标准

- 根路径、三个一级页面和三个详情标签按本文信息结构工作。
- 运行概况能分别显示请求、五个服务、Temporal 队列和三类观测数据状态。
- 部分来源失败、无数据和缓存结果有不同且可见的状态。
- 请求筛选、游标翻页、可分享 URL、空状态和刷新失败状态均可使用。
- 详情只展示当前代码合同中的模型、结果、策略、来源、耗时、工作流和步骤摘要。
- 浏览器不能控制 OpenObserve SQL、数据流、`traceId`、时间范围或返回上限。
- 原始记录权限和读取审计均为拒绝优先；审计失败时不返回记录。
- 人员操作者可以替换固定门户 Secret，服务令牌和跨站请求被拒绝，响应与日志不含 TGC。
- 确认凭据失效后维护 Schedule 暂停；替换凭据自动尝试恢复，人员操作者也可显式重试恢复。
- 非本地 PostgreSQL 连接验证 CA 和主机名，不能降级为不验证证书。
- 所有 API 错误都以错误状态返回，不能改写为成功空数据。
- 320、390 和 1440 像素浏览器测试通过。
- 类型检查、单元测试、构建、镜像构建和 Kustomize 渲染通过。

## 发布边界

应用源码、镜像发布和 namespace-neutral K8s base 位于本仓库。staging 的 ConfigMap、
Secret、Ingress、NetworkPolicy、数据库角色、OpenObserve 和 OTel 配置位于私有 GitOps
仓库。清单渲染或镜像发布不代表应用已经上线；只有环境变更合并并完成实际访问验证后，
才能记录部署完成。

## 参考资料

- Atlassian 产品需求文档：
  <https://www.atlassian.com/zh/agile/product-management/requirements>
- Temporal Web UI：<https://docs.temporal.io/web-ui>
- Langfuse 可观测性：<https://langfuse.com/docs/observability/overview>
- OpenObserve 文档：<https://openobserve.ai/docs/>
