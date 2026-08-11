---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0086
status: accepted
---

# ADR-0086 产品可用性状态页

## 背景

`campus-web` 中已有的状态语义属于班车、食堂营业等校园业务数据。产品需要一个类似 GitHub
和 Cloudflare 的公开可用性页面，回答的是 `campus.*` 第一方产品入口是否可访问，而不是校园
业务当前处于什么状态。

当前环境可能通过 staging 边缘主机进入产品，后续再映射或重定向到 `muc.wiki` 子域名，例如
`campus.muc.wiki` 或 `service.muc.wiki`。入口地址变化不能改变产品服务身份，也不能把同一产品
显示成多行。

## 决策

- 新增独立的 `status-web` Worker，并预留 `status.muc.wiki` 作为生产规范入口；不把新页面并入
  `campus-web`，以保持独立的部署和可用性边界，也不复用旧业务状态链路。
- 第一版由同一个 Worker 的 Cron handler 完成黑盒探测和快照发布，公开面只提供页面和
  `GET /api/status`；暂不拆独立 publisher、事件数据库或管理后台。
- `product-availability-snapshot.v1` 固定且按顺序发布两个公共服务身份：`campus.qa`“校园问答”和
  `campus.services`“其他服务”。域名、staging 入口和 HTTP 重定向只属于环境配置；增加公共服务必须发布新的合同版本。
- 当前只探测两个产品信号：`campus.qa` 请求 App API 的匿名 `GET /api/chat/availability`，读取最近
  15 分钟问答派发结果形成的严格三态；`campus.services` 请求 Campus shell 的 `/`，判断问答之外的
  整体站点是否可打开。探测跟随标准 HTTP 重定向，验证最终响应的状态码、内容类型和有限结构，不保存
  响应正文；文档、地图和地图地点等静态页面/数据不单独探测。
- 快照状态只有 `operational`、`degraded`、`outage`、`unknown`。超过过期时间的快照必须把当前
  状态降为 `unknown`，不能继续展示旧的正常状态。
- 第一版保存有限的当前快照和 30 天按日时间线，不建立事件、维护、通知、订阅或 incident
  实体。跨环境使用独立存储；同一环境内的入口迁移保留逻辑服务 ID 和历史时间线。
- 公共页面在 H1 后直接展示上述两个服务行，不增加分组标题或服务计数；每行直接展示当前状态、最近检查时间和以 `generatedAt` 锚定的
  30 天时间线。正常快照不展示整体状态横幅、跨服务状态计数或全局更新时间。时间线日期使用参考状态页风格的连续
  窄竖条轨道（条段高约 `32px`、间隙 `2px`，移动端铺满卡片内容宽度，桌面轨道上限为 `448px`）。所有视口
  沿用同一时间线标记并完整显示 30 天窗口，不增加日期选择器。每个服务使用一个复合 `role="slider"`，单一 Tab 停靠点，
  `aria-valuemin="1"`、`aria-valuemax="30"`、当前索引和包含日期/状态的 `aria-valuetext`；箭头键、`Home`、`End` 和轨道坐标
  选择日期，30 根竖条仅作视觉子元素且不产生横向滚动。缺失日期保持为“无历史数据”，不新增公共状态值。
  正常、受影响、中断、未知和无历史数据除颜色外，还分别使用实心、一道横向空隙、两道横向空隙、点线轮廓和
  虚线轮廓表达，图例沿用相同形状。`timeline.day` 使用 `Asia/Shanghai` 的日历日，ISO 时间戳的传输格式保持不变。
- 公共页面不展示开发、预发布或生产环境标签；环境字段只用于快照隔离和运行时配置。`generatedAt` 只作为
  时间线锚点，并在过期或读取失败的异常提示中按需展示最近成功更新时间。探测频率和时区属于运行合同，不在页面
  底部重复说明。
- 浏览器读取快照使用 10 秒请求截止时间和 `ETag` 条件缓存，并验证 v1 的固定服务顺序。页面按固定间隔自动读取，
  常态不提供手动刷新控件；初始页面提供两个与服务行同尺寸的静态骨架，首次读取失败时保留骨架并等待下一次固定间隔读取；
  禁用 JavaScript 时在服务列表内显示启用要求。自动读取失败或收到非法服务集合时保留最近快照并标记无法更新；快照过期时只保留
  历史时间线，当前状态必须显示为 `unknown`。
- 状态页保持匿名且不引入账号状态。Campus 的产品导航继续由 `campus-web` 组合；状态页用原生静态 header
  对齐相同顺序和 active 语义，不将 `CampusTopNav` 或产品导航迁入 `packages/ui`。Campus `/status` 与状态页
  `/go/campus/*` 通过环境 origin 做固定 `302`、`no-store` 重定向，探测入口和用户导航入口分开配置。
- 未知的非空 `DEPLOYMENT_ENVIRONMENT` 不再回退到 development，readiness 和发布入口按未配置处理。
- `product-availability-snapshot.v1` 是跨 runtime 的公共合同，位于 `packages/contracts`，不
  依赖 Cloudflare、KV、数据库或前端框架类型；其二元组同时固定服务数量、顺序、ID 和名称。
- staging 接入时由环境仓先提供空 Worker `status-web-staging`、独立 `STATUS_SNAPSHOT` KV namespace、
  `STATUS_QA_ORIGIN`、`STATUS_CAMPUS_ORIGIN`、`CAMPUS_WEB_PUBLIC_ORIGIN` 与 `STATUS_SNAPSHOT_KV_ID`；Campus Worker 另接收
  `STATUS_WEB_PUBLIC_ORIGIN`。入口可从 staging 边缘地址迁移到
  `muc.wiki` 子域名，源码仓不把具体域名写入 Worker 配置。Source 首次上传不可变 version 后，环境仓
  再选择该候选并创建 domain、Cron 与 deployment。
- 环境仓的 Cron 频率为每 5 分钟；快照超过 15 分钟未更新时，公开当前状态必须降为 `unknown`。

## 结果

- 状态页浏览器不依赖 `campus-web`、App API、数据库或 Langfuse 才能读取已发布快照；Cron 只通过
  App API 的匿名合同读取问答可用性，不直接访问产品数据库；
- 公共页面不会暴露内部组件名、探测地址、用户问答内容、LLM trace 或内部请求标识；
- 后续增加新的公共服务时需要定义新的合同版本并同步页面信息架构；
- 生产 custom domain、Cron、KV 和环境入口由环境仓交付，源码仓不把候选构建当作已部署事实。

## 未采用方案

- **在 `campus-web` 增加 `/status` 页面**：会与旧业务状态语义混淆，并共享学生产品的故障域；
- **让 `app-api` 直接提供状态页快照 API**：会把页面读取绑定到产品数据库和内部运行时，不能满足
  独立可用性边界；App API 只提供单一问答探测信号，不拥有聚合快照；
- **按 `app-api`、`execution-control`、`agent-runtime` 拆公共服务行**：内部实现不是用户可见的
  产品能力，且会让页面过度碎片化；
- **直接查询 Langfuse 或运维数据库**：原始观测包含不应公开的数据，也不是第一版校园服务探测
  所需的最小输入；
- **先建立事件和维护模型**：当前需求只有状态快照和时间线，没有对应的用户流程。

## 相关文档

- `apps/status-web/README.md`
- `packages/contracts/schemas/product-availability-snapshot.v1.schema.json`
- `docs/architecture/system/product-runtime.md`
